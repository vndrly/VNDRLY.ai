import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import type { GateCoverageNotice } from "./gate-coverage-monitor";
import { buildTestCookie } from "../test-utils/session";

const { deliver, publish, statePublish, watchTicket, siteEvent } = vi.hoisted(
  () => ({
    deliver: vi.fn(async (_notice: unknown) => {}),
    publish: vi.fn(),
    statePublish: vi.fn(
      async (_event: {
        userId: number;
        notificationId: number | null;
        state: string;
        changedAt?: string;
      }) => {},
    ),
    siteEvent: vi.fn(),
    watchTicket: vi.fn(async () => ({
      ticketId: null,
      shiftId: null,
      ticketBlocker: null as string | null,
    })),
  }),
);
vi.mock("./gate-alert-repository", () => ({
  processPendingGateAlert: deliver,
}));
vi.mock("../lib/notification-events", () => ({
  publishNotificationCreated: publish,
  publishNotificationStateChanged: statePublish,
}));
vi.mock("./gate-watch-ticket", () => ({ ensureGateWatchTicket: watchTicket }));
vi.mock("./gate-notification-events", () => ({
  notifyGateSiteEvent: siteEvent,
}));

import {
  acknowledgeGateStaffingAlert,
  listGateStaffingAlerts,
  reconcileGateStaffingAlert,
  resolveCoveredGateStaffingAlerts,
  staffingAlertForNotification,
  staffingNotificationMayDeliver,
} from "./gate-staffing-alerts";
import router from "../routes/gateStaffingAlerts";
import { assumeGateWatch } from "./gate-change-over";
import {
  setGateCoverageStatus,
  evaluateGateCoverage,
  databaseGateCoverageDependencies,
} from "./gate-coverage-monitor";

const app = express().use(express.json(), cookieParser(), router);

async function fixture(
  options: { held?: boolean; future?: boolean; required?: number } = {},
) {
  const key = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id",
      [`Staffing partner ${key}`],
    )
  ).rows[0].id;
  const vendor = options.held
    ? (
        await pool.query(
          "INSERT INTO vendors(id,name,contact_name,contact_email) VALUES(1054,'MidCon Solutions','Fixture','test@example.invalid') ON CONFLICT(id) DO UPDATE SET name=vendors.name RETURNING id",
        )
      ).rows[0].id
    : (
        await pool.query(
          "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id",
          [`Staffing vendor ${key}`],
        )
      ).rows[0].id;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Staffing site','Fixture',30,-100,$2) RETURNING id",
      [partner, key],
    )
  ).rows[0].id;
  const station = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Staffing gate') RETURNING id",
      [site],
    )
  ).rows[0].id;
  const work = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
      [key],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",
    [site, work, vendor],
  );
  const sessions: SessionPayload[] = [];
  for (const role of ["admin", "admin", "member"]) {
    const user = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','vendor',$1) RETURNING id",
        [`${role}-${randomUUID()}`],
      )
    ).rows[0].id;
    const person = (
      await pool.query(
        "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gate_supervisor','Fixture','test@example.invalid') RETURNING id",
        [vendor, user],
      )
    ).rows[0].id;
    const membership = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,$3,$4) RETURNING id",
        [user, vendor, role, person],
      )
    ).rows[0].id;
    await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1", [
      user,
      membership,
    ]);
    sessions.push({
      userId: user,
      role: "vendor",
      vendorId: vendor,
      vendorPeopleId: person,
      vendorRole: "gate_supervisor",
      membershipRole: role,
      activeMembershipId: membership,
      sv: 1,
    });
  }
  const at = new Date();
  const starts = new Date(
    at.getTime() + (options.future ? 12 * 3600000 : -3600000),
  );
  const ends = new Date(at.getTime() + 24 * 3600000);
  const shift = (
    await pool.query(
      `INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,site_location_id,gate_station_id,required_staff_count,created_by_id)
    VALUES('vendor',$1,'Night watch',$2,$3,'America/Chicago',$4,$5,$6,$7) RETURNING id`,
      [
        vendor,
        starts,
        ends,
        site,
        station,
        options.required ?? 1,
        sessions[0].userId,
      ],
    )
  ).rows[0].id;
  const notice = (
    kind: GateCoverageNotice["kind"] = options.future
      ? "watch_radar"
      : "uncovered",
    noticeAt = new Date(),
  ): GateCoverageNotice => ({
    kind,
    at: noticeAt,
    recipientUserIds: sessions.map((s) => s.userId!),
    candidate: {
      shiftId: shift,
      stationId: station,
      stationName: "Staffing gate",
      title: "Night watch",
      startsAt: starts,
      endsAt: ends,
      requiredCount: options.required ?? 1,
      actualCount: 0,
      assignedUserIds: [],
      recipientUserIds: sessions.map((s) => s.userId!),
      coverageMode: "active",
    },
  });
  const cover = async (session = sessions[0]) =>
    (
      await pool.query(
        "INSERT INTO gate_duty_sessions(station_id,user_id,started_at,source,idempotency_key,post_coverage) VALUES($1,$2,now(),'web',$3,$4::jsonb) RETURNING id",
        [
          station,
          session.userId,
          randomUUID(),
          JSON.stringify({ vendorId: vendor }),
        ],
      )
    ).rows[0].id;
  return { vendor, site, station, shift, sessions, notice, cover };
}

describe("shared Gate staffing incident database guarantees", () => {
  beforeAll(async () => {
    if (
      process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" ||
      process.env.VNDRLY_ISOLATED_TEST_DB !== "1"
    )
      throw new Error("Use the guarded fresh-local database harness");
    const sql = await readFile(
      new URL(
        "../../../../lib/db/drizzle/gate_staffing_alerts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pool.query(sql);
    await pool.query(sql);
  });

  it("serializes duplicate evaluations, saves mappings before delivery, and retains the episode through reminders", async () => {
    const f = await fixture();
    const mappedBeforeDelivery: Array<string | undefined> = [];
    deliver.mockImplementation(async (notice: unknown) => {
      const row = notice as { id: number };
      mappedBeforeDelivery.push(
        (await staffingAlertForNotification(row.id))?.shiftId,
      );
    });
    const [a, b] = await Promise.all([
      reconcileGateStaffingAlert(f.notice()),
      reconcileGateStaffingAlert(f.notice()),
    ]);
    expect(a?.id).toBe(b?.id);
    expect(a?.code).toMatch(/^[A-F0-9]{10}$/);
    expect(
      (
        await pool.query(
          "SELECT id FROM gate_staffing_alerts WHERE shift_id=$1",
          [f.shift],
        )
      ).rowCount,
    ).toBe(1);
    const first = (
      await pool.query(
        "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
        [a!.id],
      )
    ).rows;
    expect(first).toHaveLength(3);
    expect(mappedBeforeDelivery).toEqual([f.shift, f.shift, f.shift]);
    await reconcileGateStaffingAlert(
      f.notice("understaffed", new Date(Date.now() + 11 * 60000)),
    );
    expect(
      (await listGateStaffingAlerts(f.sessions[0])).alerts.find(
        (r) => r.id === a!.id,
      )?.code,
    ).toBe(a!.code);
    expect(
      (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
          [a!.id],
        )
      ).rowCount,
    ).toBe(6);
    deliver.mockImplementation(async () => {});
  });

  it("retains the first simultaneous admin acknowledgment, cancels retries, and never resolves coverage", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    const mapped = (
      await pool.query(
        "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
        [alert.id],
      )
    ).rows;
    await pool.query(
      "UPDATE notifications SET next_delivery_attempt_at=now(),delivery_status='retrying' WHERE id=ANY($1::int[])",
      [mapped.map((r) => r.notification_id)],
    );
    await pool.query(
      "INSERT INTO notification_channel_deliveries(notification_id,channel,status,attempt_token,next_attempt_at) VALUES($1,'sms','retryable',$2,now()),($3,'sms','accepted',$4,NULL)",
      [
        mapped[0].notification_id,
        randomUUID(),
        mapped[1].notification_id,
        randomUUID(),
      ],
    );
    const [a, b] = await Promise.all([
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "web"),
      acknowledgeGateStaffingAlert(f.sessions[1], alert.id, "ios"),
    ]);
    expect(a.acknowledgedBy).toEqual(b.acknowledgedBy);
    expect(a.acknowledgedAt).toBe(b.acknowledgedAt);
    expect(a.status).toBe("acknowledged");
    expect(a.resolvedAt).toBeNull();
    expect(
      await acknowledgeGateStaffingAlert(f.sessions[1], alert.id, "push"),
    ).toMatchObject({
      acknowledgedBy: a.acknowledgedBy,
      acknowledgedAt: a.acknowledgedAt,
    });
    await reconcileGateStaffingAlert(
      f.notice("unconfirmed", new Date(Date.now() + 21 * 60000)),
    );
    expect(
      (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
          [alert.id],
        )
      ).rows,
    ).toHaveLength(3);
    expect(
      (
        await pool.query(
          "SELECT urgent_delivery_pending,next_delivery_attempt_at FROM notifications WHERE id=ANY($1::int[])",
          [mapped.map((r) => r.notification_id)],
        )
      ).rows.every(
        (r) =>
          !r.urgent_delivery_pending && r.next_delivery_attempt_at === null,
      ),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT status FROM notification_channel_deliveries WHERE notification_id=ANY($1::int[]) ORDER BY notification_id",
          [mapped.map((r) => r.notification_id)],
        )
      ).rows.map((r) => r.status),
    ).toEqual(["cancelled", "accepted"]);
    expect(
      await staffingNotificationMayDeliver(mapped[0].notification_id),
    ).toBe(false);
  });

  it("rejects other companies, non-admins, removed authority, switched accounts, and missing site designation", async () => {
    const f = await fixture(),
      other = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    expect(
      (await listGateStaffingAlerts(other.sessions[0])).alerts,
    ).not.toContainEqual(expect.objectContaining({ id: alert.id }));
    await expect(
      acknowledgeGateStaffingAlert(other.sessions[0], alert.id, "web"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[2], alert.id, "web"),
    ).rejects.toMatchObject({ status: 403 });
    await pool.query(
      "UPDATE user_org_memberships SET role='member' WHERE id=$1",
      [f.sessions[0].activeMembershipId],
    );
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "sms"),
    ).rejects.toMatchObject({ status: 403 });
    await pool.query("UPDATE users SET active_membership_id=NULL WHERE id=$1", [
      f.sessions[1].userId,
    ]);
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[1], alert.id, "push"),
    ).rejects.toMatchObject({ status: 401 });
    await pool.query(
      "UPDATE site_work_assignments SET is_gate_contractor=false WHERE vendor_id=$1 AND site_location_id=$2",
      [f.vendor, f.site],
    );
    expect((await listGateStaffingAlerts(f.sessions[2])).alerts).toEqual([]);
  });

  it("keeps held-company facts, creates no notifications, and returns paused scope", async () => {
    const f = await fixture({ held: true }),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    expect(alert.notificationsPaused).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
          [alert.id],
        )
      ).rowCount,
    ).toBe(0);
    const result = await request(app)
      .get("/gate-staffing-alerts")
      .set("Cookie", buildTestCookie(f.sessions[0]));
    expect(result.status).toBe(200);
    expect(result.body.notificationsPaused).toBe(true);
    expect(result.body.alerts).toContainEqual(
      expect.objectContaining({ id: alert.id, notificationsPaused: true }),
    );
    const platform = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','admin','Platform fixture') RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    const platformFacts = await listGateStaffingAlerts({
      userId: platform,
      sv: 1,
      role: "admin",
    });
    expect(platformFacts.notificationsPaused).toBe(false);
    expect(platformFacts.alerts).toContainEqual(
      expect.objectContaining({
        id: alert.id,
        notificationsPaused: true,
        canAcknowledge: false,
      }),
    );
    expect(
      (await acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "web"))
        .status,
    ).toBe("acknowledged");
  });

  it("keeps radar warning and acknowledgment through assignment and critical escalation", async () => {
    const f = await fixture({ future: true }),
      first = (await reconcileGateStaffingAlert(f.notice()))!;
    expect(first).toMatchObject({ kind: "watch_radar", severity: "warning" });
    await acknowledgeGateStaffingAlert(f.sessions[0], first.id, "web");
    await pool.query(
      "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status,assigned_by_id) VALUES($1,$2,'assigned',$3)",
      [f.shift, f.sessions[2].userId, f.sessions[0].userId],
    );
    expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(0);
    await pool.query(
      "UPDATE work_hub_shifts SET starts_at=now()-interval '1 hour' WHERE id=$1",
      [f.shift],
    );
    const critical = (await reconcileGateStaffingAlert(f.notice("uncovered")))!;
    expect(critical).toMatchObject({
      id: first.id,
      code: first.code,
      status: "acknowledged",
      severity: "critical",
    });
    expect(critical.resolvedAt).toBeNull();
  });

  it("requires saved actual coverage, resolves after commit, and permits a new later gap without stale-link mutation", async () => {
    const f = await fixture(),
      first = (await reconcileGateStaffingAlert(f.notice()))!;
    await pool.query(
      "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status) VALUES($1,$2,'assigned')",
      [f.shift, f.sessions[0].userId],
    );
    expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(0);
    const duty = await f.cover();
    expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(1);
    expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(0);
    expect(
      (await listGateStaffingAlerts(f.sessions[0])).alerts,
    ).not.toContainEqual(expect.objectContaining({ id: first.id }));
    await pool.query(
      "UPDATE gate_duty_sessions SET ended_at=now() WHERE id=$1",
      [duty],
    );
    const later = (await reconcileGateStaffingAlert(
      f.notice("uncovered", new Date(Date.now() + 1000)),
    ))!;
    expect(later.id).not.toBe(first.id);
    expect(later.code).not.toBe(first.code);
    const old = await acknowledgeGateStaffingAlert(
      f.sessions[0],
      first.id,
      "web",
    );
    expect(old.status).toBe("resolved");
    expect(
      (await listGateStaffingAlerts(f.sessions[0])).alerts.find(
        (a) => a.id === later.id,
      )?.status,
    ).toBe("open");
  });

  it("suppresses old unmapped staffing backlog while leaving ordinary legacy notices deliverable", async () => {
    const f = await fixture();
    const rows = (
      await pool.query(
        "INSERT INTO notifications(user_id,type,title) VALUES($1,'gate_coverage_uncovered','Old staffing'),($1,'gate_handoff_ready','Ordinary handoff') RETURNING id",
        [f.sessions[0].userId],
      )
    ).rows;
    expect(await staffingNotificationMayDeliver(rows[0].id)).toBe(false);
    expect(await staffingNotificationMayDeliver(rows[1].id)).toBe(true);
  });

  it("resolves staffing when the watch commits even if its ticket is still unavailable", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    watchTicket.mockResolvedValueOnce({
      ticketId: null,
      shiftId: null,
      ticketBlocker: "gate_ticket.fixture_blocked",
    });
    await expect(
      assumeGateWatch(f.sessions[0], {
        stationId: f.station,
        operationId: randomUUID(),
        source: "web",
      }),
    ).resolves.toMatchObject({
      ticketId: null,
      ticketStatus: "unavailable",
      ticketBlocker: "gate_ticket.fixture_blocked",
    });
    expect(
      (
        await pool.query(
          "SELECT status,resolved_at FROM gate_staffing_alerts WHERE id=$1",
          [alert.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "resolved", resolved_at: expect.any(Date) });
    expect(
      (
        await pool.query(
          "SELECT id FROM gate_duty_sessions WHERE station_id=$1 AND ended_at IS NULL",
          [f.station],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("keeps an administrative assignment uncovered until the assignee explicitly saves Assume Watch", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    await pool.query(
      "INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2)",
      [f.station, f.sessions[0].userId],
    );
    await pool.query(
      "INSERT INTO gate_duty_sessions(station_id,user_id,source,idempotency_key,post_coverage) VALUES($1,$2,'web',$3,'{\"assigneeAcknowledged\":false}'::jsonb)",
      [f.station, f.sessions[0].userId, randomUUID()],
    );
    expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(0);
    await assumeGateWatch(f.sessions[0], {
      stationId: f.station,
      operationId: randomUUID(),
      source: "web",
    });
    expect(
      (
        await pool.query(
          "SELECT status FROM gate_staffing_alerts WHERE id=$1",
          [alert.id],
        )
      ).rows[0].status,
    ).toBe("resolved");
  });

  it("rejects stale evaluations after saved restoration and stops delivery when recipient authority changes", async () => {
    const f = await fixture(),
      notice = f.notice(),
      alert = (await reconcileGateStaffingAlert(notice))!;
    const mapping = (
      await pool.query(
        "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1 AND user_id=$2",
        [alert.id, f.sessions[0].userId],
      )
    ).rows[0];
    expect(await staffingNotificationMayDeliver(mapping.notification_id)).toBe(
      true,
    );
    await pool.query("UPDATE users SET active_membership_id=NULL WHERE id=$1", [
      f.sessions[0].userId,
    ]);
    expect(await staffingNotificationMayDeliver(mapping.notification_id)).toBe(
      false,
    );
    const duty = await f.cover(f.sessions[1]);
    await resolveCoveredGateStaffingAlerts(f.station);
    await pool.query(
      "UPDATE gate_duty_sessions SET ended_at=now() WHERE id=$1",
      [duty],
    );
    expect(await reconcileGateStaffingAlert(notice)).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT id FROM gate_staffing_alerts WHERE shift_id=$1",
          [f.shift],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("binds notification lookup to its recipient and validates API channel and current admin", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    const notification = (
      await pool.query(
        "SELECT notification_id,user_id FROM gate_staffing_alert_notifications WHERE alert_id=$1 LIMIT 1",
        [alert.id],
      )
    ).rows[0];
    expect(
      await staffingAlertForNotification(
        notification.notification_id,
        notification.user_id,
      ),
    ).toMatchObject({ id: alert.id });
    expect(
      await staffingAlertForNotification(notification.notification_id, -1),
    ).toBeNull();
    expect(
      (
        await request(app)
          .post(`/gate-staffing-alerts/${alert.id}/acknowledge`)
          .set("Cookie", buildTestCookie(f.sessions[0]))
          .send({ channel: "sms" })
      ).status,
    ).toBe(400);
    const result = await request(app)
      .post(`/gate-staffing-alerts/${alert.id}/acknowledge`)
      .set("Cookie", buildTestCookie(f.sessions[0]))
      .send({ channel: "ios" });
    expect(result.status).toBe(200);
    const href = new URL(result.body.alert.href, "https://vndrly.invalid");
    expect(href.pathname).toBe("/work-hub/calendar");
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      siteId: String(f.site),
      stationId: f.station,
      shiftId: f.shift,
    });
    expect(href.searchParams.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ends the incident and queued reminders on an intentional Gate pause or closure while retaining closure notices", async () => {
    for (const mode of [
      "paused_until",
      "paused_indefinitely",
      "closed",
    ] as const) {
      const f = await fixture(),
        alert = (await reconcileGateStaffingAlert(f.notice()))!;
      const notification = (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1 LIMIT 1",
          [alert.id],
        )
      ).rows[0].notification_id;
      expect(await staffingNotificationMayDeliver(notification)).toBe(true);
      await setGateCoverageStatus(f.sessions[0], {
        stationId: f.station,
        mode,
        pausedUntil:
          mode === "paused_until" ? new Date(Date.now() + 3600000) : null,
        reason: "No Gate coverage required during this suspension",
      });
      expect(await staffingNotificationMayDeliver(notification)).toBe(false);
      expect((await listGateStaffingAlerts(f.sessions[0])).alerts).toEqual([]);
      expect(
        (
          await pool.query(
            "SELECT status,resolved_at FROM gate_staffing_alerts WHERE id=$1",
            [alert.id],
          )
        ).rows[0],
      ).toMatchObject({ status: "resolved", resolved_at: expect.any(Date) });
      expect(await reconcileGateStaffingAlert(f.notice())).toBeNull();
      if (mode === "closed")
        expect(siteEvent).toHaveBeenCalledWith(
          f.site,
          expect.objectContaining({ type: "gate_closed" }),
        );
      await setGateCoverageStatus(f.sessions[0], {
        stationId: f.station,
        mode: "active",
      });
      const fresh = (await reconcileGateStaffingAlert(
        f.notice("uncovered", new Date(Date.now() + 1000)),
      ))!;
      expect(fresh).toMatchObject({ status: "open" });
      expect(fresh.id).not.toBe(alert.id);
    }
  });

  it("replaces a moved shift's old-context incident, silences its retries, and preserves a prior acknowledgment winner", async () => {
    const f = await fixture(),
      first = (await reconcileGateStaffingAlert(f.notice()))!;
    const notification = (
      await pool.query(
        "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1 LIMIT 1",
        [first.id],
      )
    ).rows[0].notification_id;
    await pool.query(
      "UPDATE notifications SET delivery_status='retrying',next_delivery_attempt_at=now() WHERE id=$1",
      [notification],
    );
    await pool.query(
      "INSERT INTO notification_channel_deliveries(notification_id,channel,status,attempt_token,next_attempt_at) VALUES($1,'sms','retryable',$2,now())",
      [notification, randomUUID()],
    );
    const secondStation = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Moved staffing station') RETURNING id",
        [f.site],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE work_hub_shifts SET gate_station_id=$2,version=version+1 WHERE id=$1",
      [f.shift, secondStation],
    );
    const moved = f.notice();
    moved.candidate.stationId = secondStation;
    const [second, duplicate] = await Promise.all([
      reconcileGateStaffingAlert(moved),
      reconcileGateStaffingAlert(moved),
    ]);
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first.id);
    expect(duplicate?.id).toBe(second!.id);
    expect(second).toMatchObject({
      stationId: secondStation,
      status: "open",
      notificationsPaused: false,
    });
    expect(
      (
        await pool.query(
          "SELECT status,resolution_reason FROM gate_staffing_alerts WHERE id=$1",
          [first.id],
        )
      ).rows[0],
    ).toEqual({ status: "resolved", resolution_reason: "context_changed" });
    expect(
      (
        await pool.query(
          "SELECT urgent_delivery_pending,next_delivery_attempt_at FROM notifications WHERE id=$1",
          [notification],
        )
      ).rows[0],
    ).toEqual({
      urgent_delivery_pending: false,
      next_delivery_attempt_at: null,
    });
    expect(
      (
        await pool.query(
          "SELECT status FROM notification_channel_deliveries WHERE notification_id=$1",
          [notification],
        )
      ).rows[0].status,
    ).toBe("cancelled");
    expect(await staffingNotificationMayDeliver(notification)).toBe(false);
    const winner = await acknowledgeGateStaffingAlert(
      f.sessions[0],
      second!.id,
      "web",
    );
    const nextSite = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) SELECT partner_id,'Moved staffing site','Fixture',30,-100,$2 FROM site_locations WHERE id=$1 RETURNING id",
        [f.site, randomUUID()],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) SELECT $1,work_type_id,vendor_id,true FROM site_work_assignments WHERE site_location_id=$2 AND vendor_id=$3 LIMIT 1",
      [nextSite, f.site, f.vendor],
    );
    const thirdStation = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Moved site staffing station') RETURNING id",
        [nextSite],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE work_hub_shifts SET gate_station_id=$2,site_location_id=$3,version=version+1 WHERE id=$1",
      [f.shift, thirdStation, nextSite],
    );
    const relocated = f.notice();
    relocated.candidate.stationId = thirdStation;
    const third = (await reconcileGateStaffingAlert(relocated))!;
    expect(third).toMatchObject({
      siteId: nextSite,
      stationId: thirdStation,
      status: "open",
    });
    expect(third.id).not.toBe(second!.id);
    const oldWinner = (
      await pool.query(
        "SELECT status,resolution_reason,acknowledged_at,acknowledged_by_user_id,acknowledged_channel FROM gate_staffing_alerts WHERE id=$1",
        [second!.id],
      )
    ).rows[0];
    expect(oldWinner).toMatchObject({
      status: "resolved",
      resolution_reason: "context_changed",
      acknowledged_by_user_id: winner.acknowledgedBy!.userId,
      acknowledged_channel: "web",
    });
    expect(oldWinner.acknowledged_at.toISOString()).toBe(winner.acknowledgedAt);
    const visible = (await listGateStaffingAlerts(f.sessions[0])).alerts;
    expect(visible.map((alert) => alert.id)).toEqual([third.id]);
    expect(
      (
        await pool.query(
          "SELECT id FROM gate_staffing_alerts WHERE shift_id=$1 AND resolved_at IS NULL",
          [f.shift],
        )
      ).rows.map((row) => row.id),
    ).toEqual([third.id]);
  });

  it("retains the company hold when a held shift moves to a new staffing context", async () => {
    const f = await fixture({ held: true }),
      first = (await reconcileGateStaffingAlert(f.notice()))!;
    const station = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Held replacement staffing station') RETURNING id",
        [f.site],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE work_hub_shifts SET gate_station_id=$2,version=version+1 WHERE id=$1",
      [f.shift, station],
    );
    const notice = f.notice();
    notice.candidate.stationId = station;
    const current = (await reconcileGateStaffingAlert(notice))!;
    expect(current).toMatchObject({
      stationId: station,
      status: "open",
      notificationsPaused: true,
    });
    expect(current.id).not.toBe(first.id);
    expect(
      (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=ANY($1::uuid[])",
          [[first.id, current.id]],
        )
      ).rowCount,
    ).toBe(0);
    expect((await listGateStaffingAlerts(f.sessions[0])).alerts).toContainEqual(
      expect.objectContaining({ id: current.id, notificationsPaused: true }),
    );
  });

  it("reconciles a future shift move during radar evaluations without duplicating routine warnings and suppresses a closed future Gate", async () => {
    const f = await fixture({ future: true });
    const dependencies = {
      ...databaseGateCoverageDependencies,
      loadCandidates: async (at: Date) =>
        (await databaseGateCoverageDependencies.loadCandidates(at)).filter(
          (candidate) => candidate.shiftId === f.shift,
        ),
    };
    const at = new Date();
    await evaluateGateCoverage(at, dependencies);
    const first = (await listGateStaffingAlerts(f.sessions[0])).alerts[0];
    await evaluateGateCoverage(new Date(at.getTime() + 60000), dependencies);
    expect(
      (
        await pool.query(
          "SELECT notification_id FROM gate_staffing_alert_notifications WHERE alert_id=$1",
          [first.id],
        )
      ).rowCount,
    ).toBe(3);
    const station = (
      await pool.query(
        "INSERT INTO gate_stations(site_id,name) VALUES($1,'Future moved staffing station') RETURNING id",
        [f.site],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE work_hub_shifts SET gate_station_id=$2,version=version+1 WHERE id=$1",
      [f.shift, station],
    );
    await evaluateGateCoverage(new Date(at.getTime() + 120000), dependencies);
    const moved = (await listGateStaffingAlerts(f.sessions[0])).alerts[0];
    expect(moved).toMatchObject({
      stationId: station,
      severity: "warning",
      kind: "watch_radar",
      status: "open",
    });
    expect(moved.id).not.toBe(first.id);
    expect(
      (
        await pool.query(
          "SELECT resolution_reason FROM gate_staffing_alerts WHERE id=$1",
          [first.id],
        )
      ).rows[0].resolution_reason,
    ).toBe("context_changed");
    await setGateCoverageStatus(f.sessions[0], {
      stationId: station,
      mode: "closed",
      reason: "Gate not required",
    });
    expect(
      await evaluateGateCoverage(new Date(at.getTime() + 180000), dependencies),
    ).toEqual([{ shiftId: f.shift, state: "paused" }]);
    expect((await listGateStaffingAlerts(f.sessions[0])).alerts).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT state FROM workforce_coverage_records WHERE shift_id=$1",
          [f.shift],
        )
      ).rows[0].state,
    ).toBe("resolved");
  });

  it("rechecks channel-specific authority inside the acknowledgment transaction before changing shared responsibility", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    const guard = vi.fn(
      async (client: Pick<import("pg").PoolClient, "query">) => {
        expect(
          (
            await client.query(
              "SELECT role FROM user_org_memberships WHERE id=$1 FOR SHARE",
              [f.sessions[0].activeMembershipId],
            )
          ).rows[0].role,
        ).toBe("admin");
        throw Error("Saved SMS consent was revoked");
      },
    );
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "sms", guard),
    ).rejects.toThrow("Saved SMS consent was revoked");
    expect(guard).toHaveBeenCalledOnce();
    expect(
      (
        await pool.query(
          "SELECT status,acknowledged_at FROM gate_staffing_alerts WHERE id=$1",
          [alert.id],
        )
      ).rows[0],
    ).toEqual({ status: "open", acknowledged_at: null });
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "web"),
    ).resolves.toMatchObject({ status: "acknowledged" });
  });

  it("publishes the first shared acknowledgment to every owned notification after commit without changing read state", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    const mappings = (
      await pool.query(
        'SELECT user_id AS "userId",notification_id AS "notificationId" FROM gate_staffing_alert_notifications WHERE alert_id=$1 ORDER BY notification_id',
        [alert.id],
      )
    ).rows;
    const observed: any[] = [];
    statePublish.mockClear();
    statePublish.mockImplementation(async (event) => {
      observed.push(
        (
          await pool.query(
            "SELECT a.status,a.acknowledged_by_user_id,n.user_id,n.is_read FROM gate_staffing_alerts a JOIN gate_staffing_alert_notifications m ON m.alert_id=a.id JOIN notifications n ON n.id=m.notification_id WHERE a.id=$1 AND n.id=$2",
            [alert.id, event.notificationId],
          )
        ).rows[0],
      );
    });
    const createdBefore = publish.mock.calls.length,
      deliveredBefore = deliver.mock.calls.length;
    const [first, second] = await Promise.all([
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "web"),
      acknowledgeGateStaffingAlert(f.sessions[1], alert.id, "ios"),
    ]);
    expect(first.acknowledgedBy).toEqual(second.acknowledgedBy);
    expect(statePublish.mock.calls.map(([event]) => event)).toEqual(
      mappings.map((mapping) => ({
        ...mapping,
        state: "acknowledged",
        changedAt: first.acknowledgedAt,
      })),
    );
    expect(observed).toHaveLength(mappings.length);
    expect(
      observed.every(
        (row) =>
          row.status === "acknowledged" &&
          row.acknowledged_by_user_id === first.acknowledgedBy!.userId &&
          row.is_read === false,
      ),
    ).toBe(true);
    await acknowledgeGateStaffingAlert(f.sessions[1], alert.id, "push");
    expect(statePublish).toHaveBeenCalledTimes(mappings.length);
    expect(publish).toHaveBeenCalledTimes(createdBefore);
    expect(deliver).toHaveBeenCalledTimes(deliveredBefore);
    statePublish.mockImplementation(async () => {});
  });

  it.each(["saved-watch", "monitor"] as const)(
    "publishes actual coverage resolution after the %s commit",
    async (source) => {
      const f = await fixture(),
        alert = (await reconcileGateStaffingAlert(f.notice()))!;
      const observed: string[] = [];
      statePublish.mockClear();
      statePublish.mockImplementation(async (event) => {
        observed.push(
          (
            await pool.query(
              "SELECT status FROM gate_staffing_alerts WHERE id=$1",
              [alert.id],
            )
          ).rows[0].status,
        );
      });
      await f.cover();
      if (source === "saved-watch")
        expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(1);
      else
        expect(
          await reconcileGateStaffingAlert(f.notice("restored")),
        ).toMatchObject({ status: "resolved" });
      expect(statePublish).toHaveBeenCalledTimes(3);
      expect(
        statePublish.mock.calls.every(
          ([event]) =>
            event.state === "resolved" && event.notificationId !== null,
        ),
      ).toBe(true);
      expect(observed).toEqual(["resolved", "resolved", "resolved"]);
      expect(await resolveCoveredGateStaffingAlerts(f.station)).toBe(0);
      expect(statePublish).toHaveBeenCalledTimes(3);
      statePublish.mockImplementation(async () => {});
    },
  );

  it("publishes no rolled-back or held transitions and keeps committed acknowledgment successful when publication fails", async () => {
    const f = await fixture(),
      alert = (await reconcileGateStaffingAlert(f.notice()))!;
    statePublish.mockClear();
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "sms", async () => {
        throw Error("Consent revoked");
      }),
    ).rejects.toThrow("Consent revoked");
    expect(statePublish).not.toHaveBeenCalled();
    statePublish.mockImplementation(async () => {
      throw Error("Realtime bus unavailable");
    });
    await expect(
      acknowledgeGateStaffingAlert(f.sessions[0], alert.id, "web"),
    ).resolves.toMatchObject({ status: "acknowledged" });
    statePublish.mockImplementation(async () => {});
    statePublish.mockClear();
    const held = await fixture({ held: true }),
      heldAlert = (await reconcileGateStaffingAlert(held.notice()))!;
    const createdBefore = publish.mock.calls.length,
      deliveredBefore = deliver.mock.calls.length;
    await acknowledgeGateStaffingAlert(held.sessions[0], heldAlert.id, "web");
    await held.cover();
    await resolveCoveredGateStaffingAlerts(held.station);
    expect(statePublish).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(createdBefore);
    expect(deliver).toHaveBeenCalledTimes(deliveredBefore);
  });
});
