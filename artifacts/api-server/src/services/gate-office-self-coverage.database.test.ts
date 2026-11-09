import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

vi.mock("../routes/notifications", () => ({
  notifyUsers: vi.fn(async () => 0),
  findPartnerUserIds: vi.fn(async () => []),
  findVendorUserIds: vi.fn(async () => []),
  findPartnerVisitNotifierUserIds: vi.fn(async () => []),
  findVendorVisitNotifierUserIds: vi.fn(async () => []),
}));
vi.mock("../lib/visit-events", () => ({
  publishVisitEvent: vi.fn(),
  getCurrentVisitEventSeq: vi.fn(async () => 0),
  subscribeVisitEvents: vi.fn(() => () => {}),
}));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));
import {
  assumeGateWatch,
  getChangeOverState,
  requireChangeOverAccess,
  requireGateStationManagementAccess,
  listChangeOverSites,
  listChangeOverStations,
  releaseGateWatch,
} from "./gate-change-over";
import visits from "../routes/visits";
import changes from "../routes/gateChangeOver";
import { gateWatchTicketReadiness } from "./gate-watch-ticket";

const app = express().use(express.json(), cookieParser(), visits, changes);
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.status ?? 500).json({ message: error.message }),
);

async function fixture(approved = true) {
  const key = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Fixture','fixture@example.invalid') RETURNING id",
      [key],
    )
  ).rows[0].id;
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Fixture','fixture@example.invalid') RETURNING id",
      [key],
    )
  ).rows[0].id;
  const user = (
    await pool.query(
      "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','vendor','Office fixture') RETURNING id",
      [key],
    )
  ).rows[0].id;
  const person = (
    await pool.query(
      "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'office','Office','fixture@example.invalid') RETURNING id",
      [vendor, user],
    )
  ).rows[0].id;
  const membership = (
    await pool.query(
      "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id",
      [user, vendor, person],
    )
  ).rows[0].id;
  await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1", [
    user,
    membership,
  ]);
  const work = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
      [key],
    )
  ).rows[0].id;
  const sites: number[] = [];
  for (let index = 0; index < 2; index++) {
    const site = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Fixture',30,-100,$3) RETURNING id",
        [partner, `Office site ${index} ${key}`, randomUUID()],
      )
    ).rows[0].id;
    sites.push(site);
    await pool.query(
      "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)",
      [site, work, vendor],
    );
  }
  await pool.query(
    "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status) VALUES($1,$2,'approved')",
    [partner, vendor],
  );
  if (approved) {
    await pool.query(
      "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,unit) VALUES($1,$2,50,'per_hour')",
      [vendor, work],
    );
    await pool.query(
      "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,approved_unit) VALUES($1,$2,$3,50,'per_hour')",
      [partner, vendor, work],
    );
  }
  const station = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Office coverage gate') RETURNING id",
      [sites[0]],
    )
  ).rows[0].id;
  const otherStation = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Other gate at same site') RETURNING id",
      [sites[0]],
    )
  ).rows[0].id;
  const outsideStation = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Other contracted site') RETURNING id",
      [sites[1]],
    )
  ).rows[0].id;
  const session: SessionPayload = {
    userId: user,
    role: "vendor",
    vendorId: vendor,
    activeMembershipId: membership,
    membershipRole: "member",
    vendorRole: "office",
    vendorPeopleId: person,
    sv: 1,
  };
  return {
    partner,
    vendor,
    user,
    person,
    membership,
    sites,
    station,
    otherStation,
    outsideStation,
    session,
    cookie: buildTestCookie(session),
  };
}

describe("office-only temporary Gate self-coverage", () => {
  beforeAll(() => assertFreshLocalTestDatabaseEnvironment(process.env));
  it("requires a narrow review and explicit assumption, saves the normal ticket, and revokes only temporary Gate authority on release", async () => {
    const f = await fixture();
    await expect(
      requireChangeOverAccess(pool, f.session, f.sites[0]),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getChangeOverState(f.session, f.station),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await request(app)
          .get(`/gate-change-over/${f.station}/state?purpose=assume`)
          .set("Cookie", f.cookie)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get("/visits/gate/assigned-sites")
          .set("Cookie", f.cookie)
      ).status,
    ).toBe(403);
    await expect(
      assumeGateWatch(f.session, {
        stationId: f.station,
        operationId: randomUUID(),
        source: "web",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const saved = await assumeGateWatch(f.session, {
      stationId: f.station,
      operationId: randomUUID(),
      source: "web",
      expectedWatchId: null,
      acknowledged: true,
      allowUnprepared: true,
    });
    expect(saved.ticketId).toEqual(expect.any(Number));
    expect(
      (
        await pool.query(
          "SELECT status,check_in_time,field_employee_id FROM tickets WHERE id=$1",
          [saved.ticketId],
        )
      ).rows[0],
    ).toMatchObject({
      status: "initiated",
      check_in_time: null,
      field_employee_id: f.person,
    });
    const state = await getChangeOverState(f.session, f.station);
    expect(state.shift.operator_id).toBe(f.user);
    expect(
      (await requireChangeOverAccess(pool, f.session, f.sites[0])).supervisor,
    ).toBe(false);
    expect((await listChangeOverSites(f.session)).map((s) => s.id)).toEqual([
      f.sites[0],
    ]);
    expect(
      (await listChangeOverStations(f.session, f.sites[0])).map((s) => s.id),
    ).toEqual([f.station]);
    await expect(
      getChangeOverState(f.session, f.otherStation),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getChangeOverState(f.session, f.outsideStation),
    ).rejects.toMatchObject({ status: 403 });
    const assigned = await request(app)
      .get("/visits/gate/assigned-sites")
      .set("Cookie", f.cookie);
    expect(assigned.status).toBe(200);
    expect(assigned.body.sites.map((s: any) => s.id)).toEqual([f.sites[0]]);
    const checkin = await request(app)
      .post("/visits/gate/check-in")
      .set("Cookie", f.cookie)
      .send({
        firstName: "Fixture",
        lastName: "Visitor",
        siteLocationId: f.sites[0],
        gateStationId: f.station,
        latitude: 30,
        longitude: -100,
      });
    expect(checkin.status, JSON.stringify(checkin.body)).toBe(201);
    const denied = await request(app)
      .post("/visits/gate/check-in")
      .set("Cookie", f.cookie)
      .send({
        firstName: "Fixture",
        lastName: "Visitor",
        siteLocationId: f.sites[0],
        gateStationId: f.otherStation,
        latitude: 30,
        longitude: -100,
      });
    expect(denied.status).toBe(403);
    const otherVisit = (
      await pool.query(
        "INSERT INTO site_visits(site_location_id,gate_station_id,first_name,last_name,host_type,admission_status) VALUES($1,$2,'Other','Gate visitor','partner','pending') RETURNING id",
        [f.sites[0], f.otherStation],
      )
    ).rows[0].id;
    expect(
      (
        await request(app)
          .post(`/visits/gate/${otherVisit}/admit`)
          .set("Cookie", f.cookie)
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/visits/gate/${otherVisit}/reconcile`)
          .set("Cookie", f.cookie)
          .send({ firstName: "Other", lastName: "Visitor", company: "Fixture" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/visits/gate/observations")
          .set("Cookie", f.cookie)
          .send({
            siteLocationId: f.sites[0],
            direction: "entry",
            source: "gatekeeper",
            observedAt: new Date().toISOString(),
          })
      ).status,
    ).toBe(403);
    const observed = await request(app)
      .post("/visits/gate/observations")
      .set("Cookie", f.cookie)
      .send({
        siteLocationId: f.sites[0],
        gateStationId: f.station,
        direction: "entry",
        source: "gatekeeper",
        observedAt: new Date().toISOString(),
      });
    expect(observed.status, JSON.stringify(observed.body)).toBe(201);
    expect(observed.body.gateStationId).toBe(f.station);
    const identity = (
      await pool.query(
        "SELECT u.role,m.role AS membership_role,p.vendor_role FROM users u JOIN user_org_memberships m ON m.id=u.active_membership_id JOIN vendor_people p ON p.id=m.vendor_people_id WHERE u.id=$1",
        [f.user],
      )
    ).rows[0];
    expect(identity).toEqual({
      role: "vendor",
      membership_role: "member",
      vendor_role: "office",
    });
    await releaseGateWatch(f.session, {
      stationId: f.station,
      expectedShiftId: state.shift.id,
      notes: "Office coverage complete",
    });
    await expect(
      requireChangeOverAccess(pool, f.session, f.sites[0]),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await request(app)
          .get("/visits/gate/assigned-sites")
          .set("Cookie", f.cookie)
      ).status,
    ).toBe(403);
    await expect(
      requireGateStationManagementAccess(pool, f.session, f.sites[0]),
    ).resolves.toBeUndefined();
    expect(
      (
        await pool.query(
          "SELECT p.vendor_role FROM vendor_people p WHERE p.id=$1",
          [f.person],
        )
      ).rows[0].vendor_role,
    ).toBe("office");
    expect(
      (
        await pool.query("SELECT id FROM tickets WHERE created_by_id=$1", [
          f.user,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("denies another company and stale membership while preserving authorized temporary custody without a ticket", async () => {
    const f = await fixture(false),
      other = await fixture();
    expect(
      (
        await request(app)
          .get(`/gate-change-over/${other.station}/state?purpose=assume`)
          .set("Cookie", f.cookie)
      ).status,
    ).toBe(403);
    await expect(
      assumeGateWatch(f.session, {
        stationId: f.station,
        operationId: randomUUID(),
        source: "ios",
        expectedWatchId: null,
        acknowledged: true,
        allowUnprepared: true,
      }),
    ).resolves.toMatchObject({
      ticketId: null,
      ticketStatus: "unavailable",
      ticketBlocker: "gate_ticket.approved_service_required",
    });
    expect(
      (
        await pool.query("SELECT id FROM gate_duty_sessions WHERE user_id=$1", [
          f.user,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query("SELECT id FROM gate_shifts WHERE operator_id=$1", [
          f.user,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await pool.query("SELECT id FROM tickets WHERE created_by_id=$1",[f.user])).rowCount).toBe(0);
    await pool.query("UPDATE users SET active_membership_id=NULL WHERE id=$1", [
      f.user,
    ]);
    expect(
      (
        await request(app)
          .get(`/gate-change-over/${f.station}/state?purpose=assume`)
          .set("Cookie", f.cookie)
      ).status,
    ).toBe(403);
  });

  it("preflights the exact selected shift when two eligible watches share one station", async () => {
    const f = await fixture(),
      shifts: string[] = [];
    for (let index = 0; index < 2; index++) {
      const shift = (
        await pool.query(
          "INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,site_location_id,gate_station_id,created_by_id,ticket_number) VALUES('vendor',$1,'Selected watch',now()-interval '1 hour',now()+interval '8 hours','UTC',$2,$3,$4,$5) RETURNING id",
          [
            f.vendor,
            f.sites[0],
            f.station,
            f.user,
            index === 0 ? "missing-saved-ticket" : null,
          ],
        )
      ).rows[0].id;
      shifts.push(shift);
      await pool.query(
        "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status) VALUES($1,$2,'assigned')",
        [shift, f.user],
      );
    }
    expect(
      (await gateWatchTicketReadiness(pool, f.session, f.station, f.sites[0]))
        .ticketBlocker,
    ).toBe("gate_ticket.ambiguous_shift");
    expect(
      await gateWatchTicketReadiness(
        pool,
        f.session,
        f.station,
        f.sites[0],
        undefined,
        false,
        shifts[0],
      ),
    ).toMatchObject({
      shiftId: shifts[0],
      ticketBlocker: "gate_ticket.scheduled_ticket_unavailable",
    });
    expect(
      await gateWatchTicketReadiness(
        pool,
        f.session,
        f.station,
        f.sites[0],
        undefined,
        false,
        shifts[1],
      ),
    ).toMatchObject({ shiftId: shifts[1], ticketBlocker: null });
    const missing = randomUUID();
    expect(
      await gateWatchTicketReadiness(
        pool,
        f.session,
        f.station,
        f.sites[0],
        undefined,
        false,
        missing,
      ),
    ).toMatchObject({
      shiftId: missing,
      ticketBlocker: "gate_ticket.selected_shift_unavailable",
    });
  });
});

