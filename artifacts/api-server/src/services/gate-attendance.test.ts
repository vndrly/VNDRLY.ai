import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { startWorkSession } from "./gate-duty";
import {
  createAttendanceException,
  recordTrackingException,
  resolveAttendanceException,
  setTravelEta,
} from "./gate-attendance";

async function fixture() {
  const suffix = randomUUID();
  const partner = (await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id", [`Attendance partner ${suffix}`])).rows[0].id;
  const vendor = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id", [`Attendance vendor ${suffix}`])).rows[0].id;
  const site = (await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Attendance site','Fixture',30,-100,$2) RETURNING id", [partner, suffix])).rows[0].id;
  const workType = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [`Attendance ${suffix}`])).rows[0].id;
  await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$2,$3)", [site, workType, vendor]);
  const stationId = (await pool.query("INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id", [site, `Gate ${suffix}`])).rows[0].id;
  const sessions: SessionPayload[] = [];
  for (const role of ["gatekeeper", "gate_supervisor"]) {
    const username = `${role}-${randomUUID()}`;
    const userId = (await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,$2,'vendor',$3) RETURNING id", [username, await bcrypt.hash("fixture-password", 4), role])).rows[0].id;
    const personId = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,$3,$4) RETURNING id", [vendor, userId, role, `${username}@example.invalid`])).rows[0].id;
    const membershipId = (await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,$3,$4) RETURNING id", [userId, vendor, role === "gate_supervisor" ? "admin" : "member", personId])).rows[0].id;
    sessions.push({ userId, role: "vendor", vendorId: vendor, vendorRole: role, membershipRole: role === "gate_supervisor" ? "admin" : "member", activeMembershipId: membershipId, sv: 1 });
  }
  const [worker, supervisor] = sessions;
  const shiftId = (await pool.query(`INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,site_location_id,gate_station_id,required_staff_count,work_start_policy,created_by_id) VALUES('vendor',$1,$2,now(),now()+interval '12 hours','America/Chicago',$3,$4,1,'paid_travel',$5) RETURNING id`, [vendor, `Shift ${suffix}`, site, stationId, supervisor!.userId])).rows[0].id;
  await pool.query("INSERT INTO work_hub_shift_assignments(shift_id,user_id,status,assigned_by_id) VALUES($1,$2,'assigned',$3)", [shiftId, worker!.userId, supervisor!.userId]);
  return { stationId, shiftId, worker: worker!, supervisor: supervisor! };
}

describe("Gate attendance and travel", () => {
  beforeAll(() => {
    if (process.env.VNDRLY_ISOLATED_TEST_DB !== "1") throw new Error("Run Gate attendance tests through the isolated database wrapper");
  });

  it("keeps a paid shift started when GPS is unavailable and records the exception", async () => {
    const f = await fixture();
    const started = await startWorkSession(f.worker, { workHubShiftId: f.shiftId, stationId: f.stationId, source: "ios", idempotencyKey: randomUUID(), locationSharingActive: false });
    expect(started.workSession.trackingStatus).toBe("exception");
    const updated = await recordTrackingException(f.worker, started.workSession.id, "Location permission is off");
    expect(updated).toMatchObject({ trackingStatus: "exception", trackingExceptionReason: "Location permission is off" });
  });

  it("stores an ETA without turning travel into gate coverage", async () => {
    const f = await fixture();
    const started = await startWorkSession(f.worker, { workHubShiftId: f.shiftId, stationId: f.stationId, source: "ios", idempotencyKey: randomUUID(), locationSharingActive: true });
    const etaAt = new Date(Date.now() + 25 * 60_000);
    const updated = await setTravelEta(f.worker, started.workSession.id, { etaAt, source: "gps" });
    expect(updated).toMatchObject({ travelStatus: "en_route", etaSource: "gps" });
    const duty = await pool.query("SELECT id FROM gate_duty_sessions WHERE work_session_id=$1", [started.workSession.id]);
    expect(duty.rowCount).toBe(0);
  });

  it("allows only a supervisor or admin to classify a missed assignment", async () => {
    const f = await fixture();
    const exception = await createAttendanceException(f.shiftId, f.worker.userId!);
    await expect(resolveAttendanceException(f.worker, exception.id, { disposition: "excused", reason: "Dental appointment" })).rejects.toMatchObject({ code: "change_over.supervisor_required" });
    await expect(resolveAttendanceException(f.supervisor, exception.id, { disposition: "reassigned", reason: "Supervisor covered the gate" })).resolves.toMatchObject({ state: "resolved", disposition: "reassigned" });
  });
});
