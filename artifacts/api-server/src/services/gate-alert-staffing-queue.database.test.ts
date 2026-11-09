import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

const { push } = vi.hoisted(() => ({
  push: vi.fn(async (_notice: unknown, _badge: number) => ({ accepted: true, providerMessageId: "local-provider-receipt" })),
}));
vi.mock("./gate-alert-push", async original => ({
  ...await original<typeof import("./gate-alert-push")>(),
  sendGateAlertPush: push,
  retryGateAlertPushCleanup: vi.fn(async () => {}),
}));

import { processPendingGateAlert, retryGateAlertChannels } from "./gate-alert-repository";
import * as staffing from "./gate-staffing-alerts";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local";

async function recipient() {
  const key = randomUUID();
  const partner = (await pool.query(
    "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id", [key],
  )).rows[0].id;
  const vendor = (await pool.query(
    "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id", [key],
  )).rows[0].id;
  const site = (await pool.query(
    "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Fixture',30,-100,$2) RETURNING id", [partner, key],
  )).rows[0].id;
  const station = (await pool.query(
    "INSERT INTO gate_stations(site_id,name) VALUES($1,'Queue test gate') RETURNING id", [site],
  )).rows[0].id;
  const work = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [key])).rows[0].id;
  await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [site, work, vendor]);
  const userId = (await pool.query(
    "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','vendor','Queue operator') RETURNING id", [key],
  )).rows[0].id;
  const person = (await pool.query(
    "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper','Queue','test@example.invalid') RETURNING id", [vendor, userId],
  )).rows[0].id;
  const membership = (await pool.query(
    "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id", [userId, vendor, person],
  )).rows[0].id;
  await pool.query("UPDATE users SET active_membership_id=$2 WHERE id=$1", [userId, membership]);
  return { userId, vendor, site, station, link: `/gate?stationId=${station}` };
}

async function queued(userId: number, link: string, type = "gate_coverage_uncovered") {
  return (await pool.query(`INSERT INTO notifications(user_id,type,title,link,urgent_delivery_pending,next_delivery_attempt_at,acknowledgement_due_at,delivery_status)
    VALUES($1,$2,'Queue fixture',$3,true,now()-interval '1 minute',now(),'retrying')
    RETURNING id,user_id AS "userId",type,title,link`, [userId, type, link])).rows[0];
}

async function channel(notificationId: number, name: string, status: string) {
  const token = randomUUID();
  await pool.query(`INSERT INTO notification_channel_deliveries(notification_id,channel,status,attempt_token,next_attempt_at,provider_message_id)
    VALUES($1,$2,$3,$4,now()-interval '1 minute',$5)`, [notificationId, name, status, token, `audit-${token}`]);
}

/** The full suite retains other files' fixtures in this same fresh database.
 * Scope only the worker's batch inventory to this test's recipient. Ordering,
 * limit, leases, policy reads, mutations and delivery claims still use real SQL.
 */
async function retryOwnedQueue(userId: number) {
  const query = pool.query.bind(pool);
  const inventory = vi.spyOn(pool, "query").mockImplementation(((sql: unknown, ...args: unknown[]) => {
    if (typeof sql === "string" && sql.startsWith("SELECT DISTINCT n.id,")) {
      const scoped = sql.replace(/ORDER BY n\.id LIMIT 100\s*$/, "AND n.user_id = $1 ORDER BY n.id LIMIT 100");
      if (scoped === sql || args.length) throw new Error("Update the fixture scope for the changed queue inventory query");
      return Reflect.apply(query, pool, [scoped, [userId]]);
    }
    return Reflect.apply(query, pool, [sql, ...args]);
  }) as typeof pool.query);
  try { return await retryGateAlertChannels(); }
  finally { inventory.mockRestore(); }
}

async function currentStaffingNotice(owner: Awaited<ReturnType<typeof recipient>>) {
  const shift = (await pool.query(`INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,site_location_id,gate_station_id,created_by_id)
    VALUES('vendor',$1,'Open queue watch',now()-interval '1 hour',now()+interval '8 hours','UTC',$2,$3,$4) RETURNING id`,
  [owner.vendor, owner.site, owner.station, owner.userId])).rows[0].id;
  const incident = (await pool.query(`INSERT INTO gate_staffing_alerts(code,owner_org_type,owner_org_id,site_id,station_id,shift_id,kind,severity,required_count,actual_count)
    VALUES($1,'vendor',$2,$3,$4,$5,'uncovered','critical',1,0) RETURNING id`,
  [randomUUID(), owner.vendor, owner.site, owner.station, shift])).rows[0].id;
  const notice = await queued(owner.userId, owner.link);
  await pool.query("INSERT INTO gate_staffing_alert_notifications(notification_id,alert_id,user_id) VALUES($1,$2,$3)", [notice.id, incident, owner.userId]);
  return notice;
}

describe.skipIf(!isolated)("staffing retry queue draining", () => {
  beforeAll(() => { assertFreshLocalTestDatabaseEnvironment(process.env); });
  beforeEach(() => { push.mockClear(); vi.restoreAllMocks(); });

  it("drains 100 suppressed legacy rows so a later urgent alert reaches the provider on the next run", async () => {
    const owner = await recipient();
    const blocked = (await pool.query(`INSERT INTO notifications(user_id,type,title,link,is_read,urgent_delivery_pending,next_delivery_attempt_at,acknowledgement_due_at,delivery_status)
      SELECT $1,'gate_coverage_uncovered','Unmapped legacy staffing',$2,true,true,now()-interval '1 minute',now(),'retrying'
      FROM generate_series(1,100) RETURNING id`, [owner.userId, owner.link])).rows.map(row => row.id);
    await channel(blocked[0], "push", "retryable");
    const allowed = await queued(owner.userId, owner.link, "safety_stop_work");

    expect(await retryOwnedQueue(owner.userId)).toBe(100);
    expect(push).not.toHaveBeenCalled();
    const stopped = (await pool.query(`SELECT urgent_delivery_pending,next_delivery_attempt_at,acknowledgement_due_at,delivery_status
      FROM notifications WHERE id=ANY($1::int[])`, [blocked])).rows;
    expect(stopped).toHaveLength(100);
    expect(stopped.every(row => !row.urgent_delivery_pending && row.next_delivery_attempt_at === null && row.acknowledgement_due_at === null && row.delivery_status === "cancelled")).toBe(true);
    expect((await pool.query("SELECT status,next_attempt_at FROM notification_channel_deliveries WHERE notification_id=$1", [blocked[0]])).rows[0]).toEqual({ status: "cancelled", next_attempt_at: null });

    expect(await retryOwnedQueue(owner.userId)).toBe(1);
    expect(push).toHaveBeenCalledOnce();
    expect(push.mock.calls[0]?.[0]).toMatchObject({ id: allowed.id });
    expect(await retryOwnedQueue(owner.userId)).toBe(0);
  });

  it("preserves an active worker lease and all of its queued channel state", async () => {
    const owner = await recipient(), notice = await queued(owner.userId, owner.link);
    const lease = randomUUID();
    await pool.query("UPDATE notifications SET urgent_delivery_lease=$2,urgent_delivery_leased_until=now()+interval '5 minutes' WHERE id=$1", [notice.id, lease]);
    await channel(notice.id, "push", "retryable");
    await processPendingGateAlert(notice);
    expect((await pool.query("SELECT urgent_delivery_pending,urgent_delivery_lease,next_delivery_attempt_at IS NOT NULL AS generic_retry FROM notifications WHERE id=$1", [notice.id])).rows[0]).toEqual({ urgent_delivery_pending: true, urgent_delivery_lease: lease, generic_retry: true });
    expect((await pool.query("SELECT status FROM notification_channel_deliveries WHERE notification_id=$1", [notice.id])).rows[0].status).toBe("retryable");
    expect(push).not.toHaveBeenCalled();
  });

  it("drains expired leases and retryable channels without rewriting accepted, unknown, or sending audit", async () => {
    const owner = await recipient();
    for (const retained of ["accepted", "unknown", "sending"]) {
      const notice = await queued(owner.userId, owner.link);
      await pool.query("UPDATE notifications SET urgent_delivery_lease=$2,urgent_delivery_leased_until=now()-interval '1 second' WHERE id=$1", [notice.id, randomUUID()]);
      await channel(notice.id, "push", "retryable");
      await channel(notice.id, "sms", retained);
      const audit = (await pool.query("SELECT * FROM notification_channel_deliveries WHERE notification_id=$1 AND channel='sms'", [notice.id])).rows[0];
      await processPendingGateAlert(notice);
      expect((await pool.query("SELECT urgent_delivery_pending,urgent_delivery_lease,urgent_delivery_leased_until FROM notifications WHERE id=$1", [notice.id])).rows[0]).toEqual({ urgent_delivery_pending: false, urgent_delivery_lease: null, urgent_delivery_leased_until: null });
      expect((await pool.query("SELECT status,next_attempt_at FROM notification_channel_deliveries WHERE notification_id=$1 AND channel='push'", [notice.id])).rows[0]).toEqual({ status: "cancelled", next_attempt_at: null });
      expect((await pool.query("SELECT * FROM notification_channel_deliveries WHERE notification_id=$1 AND channel='sms'", [notice.id])).rows[0]).toEqual(audit);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps pending work and channel retries when the staffing state lookup is unavailable", async () => {
    const owner = await recipient(), notice = await currentStaffingNotice(owner);
    await channel(notice.id, "push", "retryable");
    const lookup = vi.spyOn(staffing, "staffingNotificationMayDeliver").mockRejectedValueOnce(new Error("temporary lookup outage"));
    await expect(processPendingGateAlert(notice)).rejects.toThrow("temporary lookup outage");
    expect((await pool.query("SELECT urgent_delivery_pending,next_delivery_attempt_at IS NOT NULL AS generic_retry FROM notifications WHERE id=$1", [notice.id])).rows[0]).toEqual({ urgent_delivery_pending: true, generic_retry: true });
    expect((await pool.query("SELECT status FROM notification_channel_deliveries WHERE notification_id=$1", [notice.id])).rows[0].status).toBe("retryable");
    expect(push).not.toHaveBeenCalled();
    lookup.mockRestore();
    await processPendingGateAlert(notice);
    expect((await pool.query("SELECT urgent_delivery_pending FROM notifications WHERE id=$1", [notice.id])).rows[0].urgent_delivery_pending).toBe(false);
    expect(push).toHaveBeenCalledOnce();
  });

  it("does not mistake an unavailable hold lookup for a permanent denial of an open incident", async () => {
    const owner = await recipient(), notice = await currentStaffingNotice(owner);
    await channel(notice.id, "push", "retryable");
    const query = pool.query.bind(pool);
    const outage = vi.spyOn(pool, "query").mockImplementation(((sql: unknown, ...args: unknown[]) => {
      if (typeof sql === "string" && sql.includes("SELECT DISTINCT recipient.user_id"))
        return Promise.reject(new Error("temporary company hold lookup outage"));
      return Reflect.apply(query, pool, [sql, ...args]);
    }) as typeof pool.query);
    await expect(processPendingGateAlert(notice)).rejects.toThrow("temporary company hold lookup outage");
    outage.mockRestore();
    expect((await pool.query("SELECT urgent_delivery_pending,next_delivery_attempt_at IS NOT NULL AS generic_retry FROM notifications WHERE id=$1", [notice.id])).rows[0]).toEqual({ urgent_delivery_pending: true, generic_retry: true });
    expect((await pool.query("SELECT status FROM notification_channel_deliveries WHERE notification_id=$1", [notice.id])).rows[0].status).toBe("retryable");
    expect(push).not.toHaveBeenCalled();
    await processPendingGateAlert(notice);
    expect(push).toHaveBeenCalledOnce();
  });

  it("retains claimed pending work when a later channel hold lookup becomes unavailable", async () => {
    const owner = await recipient(), notice = await currentStaffingNotice(owner);
    await channel(notice.id, "push", "retryable");
    const query = pool.query.bind(pool);
    let holdLookups = 0;
    const outage = vi.spyOn(pool, "query").mockImplementation(((sql: unknown, ...args: unknown[]) => {
      if (typeof sql === "string" && sql.includes("SELECT DISTINCT recipient.user_id") && ++holdLookups >= 3)
        return Promise.reject(new Error("channel company hold lookup outage"));
      return Reflect.apply(query, pool, [sql, ...args]);
    }) as typeof pool.query);
    await processPendingGateAlert(notice);
    outage.mockRestore();
    expect((await pool.query("SELECT urgent_delivery_pending,urgent_delivery_lease IS NOT NULL AS leased FROM notifications WHERE id=$1", [notice.id])).rows[0]).toEqual({ urgent_delivery_pending: true, leased: true });
    expect((await pool.query("SELECT status FROM notification_channel_deliveries WHERE notification_id=$1", [notice.id])).rows[0].status).toBe("retryable");
    expect(push).not.toHaveBeenCalled();
    await pool.query("UPDATE notifications SET urgent_delivery_leased_until=now()-interval '1 second' WHERE id=$1", [notice.id]);
    await processPendingGateAlert(notice);
    expect(push).toHaveBeenCalledOnce();
  });
});
