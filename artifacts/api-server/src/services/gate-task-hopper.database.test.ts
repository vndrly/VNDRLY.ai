import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { migrateGateTaskHopper } from "../../scripts/migrate-gate-task-hopper";
import { gateTaskOptions, mutateGateTask, readGateTaskHopper } from "./gate-task-hopper";
import { workdayService } from "./workday";
import { getChangeOverState, startGateShift, prepareGateHandoff } from "./gate-change-over";
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("../routes/notifications", () => ({ notifyUsers: vi.fn().mockResolvedValue(undefined) }));
beforeAll(async () => {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  await pool.query(await readFile(new URL("../../../../lib/db/drizzle/gate_change_over.sql", import.meta.url), "utf8"));
});
async function fixture() {
  const key = randomUUID();
  const vendor = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id", [key])).rows[0].id;
  const partner = (await pool.query("INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Fixture','test@example.invalid') RETURNING id", [key])).rows[0].id;
  const work = (await pool.query("INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id", [key])).rows[0].id;
  const gates: { id: string; site_id: number }[] = [];
  for (const label of ["East", "West"]) {
    const site = (await pool.query("INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Fixture',30,-100,$3) RETURNING id", [partner, `${label} ${key}`, randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [site, work, vendor]);
    gates.push((await pool.query("SELECT id,site_id FROM gate_stations WHERE site_id=$1 LIMIT 1", [site])).rows[0]);
  }
  const sessions: SessionPayload[] = [];
  for (const role of ["gatekeeper", "gatekeeper", "office"]) {
    const user = (await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'not-a-real-password','vendor',$2) RETURNING id", [randomUUID(), `${role} fixture`])).rows[0].id;
    const person = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,'Fixture','test@example.invalid') RETURNING id", [vendor, user, role])).rows[0].id;
    const member = (await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id", [user, vendor, person])).rows[0].id;
    sessions.push({ userId: user, role: "vendor", vendorId: vendor, vendorPeopleId: person, vendorRole: role, membershipRole: "member", activeMembershipId: member, sv: 1 });
  }
  return { vendor, partner, work, gates, worker: sessions[0]!, relief: sessions[1]!, office: sessions[2]! };
}
async function start(session: SessionPayload) {
  return workdayService.recordAssistant(session, { operationId: randomUUID(), action: "start_shift", expectedShiftId: null, timezone: "America/Chicago" });
}
async function create(f: Awaited<ReturnType<typeof fixture>>, session = f.office) {
  return mutateGateTask(session, { operationId: randomUUID(), action: "create", stationId: f.gates[1]!.id, text: "Inspect west gate lamp" });
}
it("lets overlapping on-shift gatekeepers complete vendor tasks across sites without either holding a watch, and records the actual completion on calendar", async () => {
  const f = await fixture(); await start(f.worker); await start(f.relief);
  const made = await create(f, f.worker);
  const options = await gateTaskOptions(f.relief);
  expect(options.gates.map(gate => gate.stationId)).toEqual(expect.arrayContaining(f.gates.map(gate => gate.id)));
  expect(options.canComplete).toBe(true);
  const finished = await mutateGateTask(f.relief, { operationId: randomUUID(), action: "complete", taskId: made.task.id, expectedVersion: made.task.version, note: "Lamp replaced and tested" });
  expect(finished.task.gateHopper).toMatchObject({ completedById: f.relief.userId, completionNote: "Lamp replaced and tested", stationId: f.gates[1]!.id });
  expect((await readGateTaskHopper(f.worker, {})).tasks).toHaveLength(0);
  expect((await pool.query("SELECT id FROM gate_shifts WHERE operator_id=ANY($1::int[])", [[f.worker.userId, f.relief.userId]])).rows).toHaveLength(0);
  expect((await workdayService.current(f.worker)).workday).not.toBeNull();
  const { default: routes } = await import("../routes/workHubOperations");
  const app = express().use(cookieParser()).use(routes);
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
  const calendar = await request(app).get("/work-hub/calendar").query({ start: from, end: to }).set("Cookie", buildTestCookie(f.relief));
  expect(calendar.status, JSON.stringify(calendar.body)).toBe(200);
  expect(calendar.body.tasks.some((row: any) => row.item.id === made.task.id && row.item.gateHopper.completedById === f.relief.userId)).toBe(true);
});
it("rejects off-shift completion, foreign vendors and forged gatekeeper roles; completion never starts a shift", async () => {
  const f = await fixture(), foreign = await fixture(), made = await create(f);
  const command = { operationId: randomUUID(), action: "complete" as const, taskId: made.task.id, expectedVersion: 1, note: "Checked" };
  await expect(mutateGateTask(f.worker, command)).rejects.toMatchObject({ status: 403 });
  expect((await workdayService.current(f.worker)).workday).toBeNull();
  await start(foreign.worker);
  await expect(mutateGateTask(foreign.worker, command)).rejects.toMatchObject({ status: 404 });
  expect((await readGateTaskHopper(foreign.worker, { taskId: made.task.id })).tasks).toHaveLength(0);
  await pool.query("UPDATE vendor_people SET vendor_role='field' WHERE id=$1", [f.worker.vendorPeopleId]);
  await expect(readGateTaskHopper({ ...f.worker, vendorRole: "gatekeeper" }, {})).rejects.toMatchObject({ status: 403 });
});
it("serializes assignment/completion, replays exact receipts once, and retains cleared task history", async () => {
  const f = await fixture(), made = await create(f); await start(f.worker);
  const complete = { operationId: randomUUID(), action: "complete" as const, taskId: made.task.id, expectedVersion: 1, note: "Fixed" };
  const race = await Promise.allSettled([mutateGateTask(f.worker, complete), mutateGateTask(f.office, { operationId: randomUUID(), action: "assign", taskId: made.task.id, expectedVersion: 1, assigneeUserId: f.relief.userId })]);
  expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(race.filter(result => result.status === "rejected")).toHaveLength(1);
  const cleared = await create(f), remove = { operationId: randomUUID(), action: "delete" as const, taskId: cleared.task.id, expectedVersion: 1 };
  await expect(mutateGateTask(f.worker, remove)).rejects.toMatchObject({ status: 403 });
  const receipt = await mutateGateTask(f.office, remove);
  expect((await mutateGateTask(f.office, remove))).toEqual({ ...receipt, replayed: true });
  await expect(mutateGateTask(f.office, { ...remove, action: "clear" })).rejects.toMatchObject({ status: 409 });
  expect((await pool.query("SELECT status FROM work_hub_tasks WHERE id=$1", [cleared.task.id])).rows[0].status).toBe("cancelled");
  expect((await pool.query("SELECT id FROM work_hub_task_events WHERE task_id=$1", [cleared.task.id])).rows).toHaveLength(2);
});
it("imports open legacy actions once, leaves resolved and ambiguous ownership untouched, and preserves source history", async () => {
  const f = await fixture(), open = randomUUID(), resolved = randomUUID();
  for (const id of [open, resolved]) await pool.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'open','Legacy action')", [f.gates[0]!.id, f.worker.userId, id]);
  await pool.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'resolve','Legacy resolution')", [f.gates[0]!.id, f.worker.userId, resolved]);
  const c = await pool.connect();
  try { await migrateGateTaskHopper(c); await migrateGateTaskHopper(c); } finally { c.release(); }
  expect((await readGateTaskHopper(f.worker, {})).tasks.map(task => task.id)).toContain(open);
  expect((await pool.query("SELECT id FROM work_hub_tasks WHERE id=$1", [resolved])).rows).toHaveLength(0);
  expect((await pool.query("SELECT id FROM work_hub_task_events WHERE task_id=$1", [open])).rows).toHaveLength(1);
  expect((await pool.query("SELECT id FROM gate_shift_actions WHERE item_id=ANY($1::uuid[])", [[open, resolved]])).rows).toHaveLength(3);
});
it("lets an explicitly assigned non-gate employee complete their task, but not browse or create hopper work", async () => {
  const f = await fixture(), made = await create(f);
  await pool.query("UPDATE vendor_people SET vendor_role='field' WHERE id=$1", [f.relief.vendorPeopleId]);
  const employee = { ...f.relief, vendorRole: "field" };
  await start(employee);
  const assigned = await mutateGateTask(f.office, { operationId: randomUUID(), action: "assign", taskId: made.task.id, expectedVersion: 1, assigneeUserId: employee.userId });
  await expect(readGateTaskHopper(employee, {})).rejects.toMatchObject({ status: 403 });
  expect((await readGateTaskHopper(employee, { taskId: made.task.id })).tasks).toHaveLength(1);
  expect((await gateTaskOptions(employee, made.task.id)).canComplete).toBe(true);
  const completed = await mutateGateTask(employee, { operationId: randomUUID(), action: "complete", taskId: made.task.id, expectedVersion: assigned.task.version, note: "Repaired the lamp" });
  expect(completed.task.gateHopper.completedById).toBe(employee.userId);
  await expect(create(f, employee)).rejects.toMatchObject({ status: 403 });
});
it("keeps private vendor hopper text out of another contractor's Gate state and saved facts while preserving the common revision", async () => {
  const f = await fixture(), other = await fixture(), made = await create(f);
  await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [f.gates[1]!.site_id, f.work, other.vendor]);
  await startGateShift(f.worker, f.gates[1]!.id);
  await prepareGateHandoff(f.worker, f.gates[1]!.id, "Shared operator notes", async facts => ({ source: "structured_facts", facts }));
  const own = await getChangeOverState(f.worker, f.gates[1]!.id), foreign = await getChangeOverState(other.worker, f.gates[1]!.id);
  expect(JSON.stringify(own)).toContain("Inspect west gate lamp");
  expect(JSON.stringify(foreign)).not.toContain("Inspect west gate lamp");
  expect(foreign.snapshot?.revision).toBe(own.snapshot?.revision);
  expect(foreign.preparation?.snapshot.openItems.some((item: any) => item.id === made.task.id)).toBe(false);
});
it("retains ambiguous legacy actions for explicit office attribution and imports them without duplication", async () => {
  const f = await fixture(), other = await fixture(), id = randomUUID();
  await pool.query("INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor) VALUES($1,$2,$3,true)", [f.gates[0]!.site_id, f.work, other.vendor]);
  await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'member')", [f.worker.userId, other.vendor]);
  await pool.query("INSERT INTO gate_shift_actions(station_id,actor_id,item_id,kind,text) VALUES($1,$2,$3,'open','Original ambiguous action')", [f.gates[0]!.id, f.worker.userId, id]);
  const c = await pool.connect(); try { await migrateGateTaskHopper(c); } finally { c.release(); }
  expect((await readGateTaskHopper(f.worker, { stationId: f.gates[0]!.id })).unimported.some(item => item.id === id)).toBe(true);
  await expect(mutateGateTask(f.worker, { operationId: randomUUID(), action: "import", taskId: id, stationId: f.gates[0]!.id })).rejects.toMatchObject({ status: 403 });
  const adopted = await mutateGateTask(f.office, { operationId: randomUUID(), action: "import", taskId: id, stationId: f.gates[0]!.id });
  expect(adopted.task.ownerOrgId).toBe(f.vendor);
  expect((await pool.query("SELECT id FROM gate_shift_actions WHERE item_id=$1", [id])).rows).toHaveLength(1);
  expect((await readGateTaskHopper(f.worker, { stationId: f.gates[0]!.id })).unimported.some(item => item.id === id)).toBe(false);
});
it("waits for the station lock used by handoff preparation before recording a task change", async () => {
  const f = await fixture(), holder = await pool.connect();
  await holder.query("BEGIN"); await holder.query("SELECT id FROM gate_stations WHERE id=$1 FOR UPDATE", [f.gates[1]!.id]);
  let finished = false;
  const pending = create(f).then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(finished).toBe(false);
  await holder.query("COMMIT"); holder.release();
  expect((await pending).task.title).toBe("Inspect west gate lamp");
});
