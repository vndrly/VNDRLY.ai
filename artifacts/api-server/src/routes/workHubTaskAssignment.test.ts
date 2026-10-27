import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { resolveContext } from "./auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { SessionPayload } from "../lib/session";
import { buildTestCookie } from "../test-utils/session";
import operations from "./workHubOperations";
const notify = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./notifications", () => ({ notifyUsers: notify }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(operations);
async function fixture() {
  const vendor = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Fixture','fixture@example.invalid') RETURNING id", [randomUUID()])).rows[0].id;
  const people: { id: number; cookie: string }[] = [];
  for (const role of ["admin", "office", "field", "admin", "inactive"]) {
    const id = (await pool.query("INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'fixture','vendor',$2) RETURNING id", [randomUUID(), `${role} fixture`])).rows[0].id;
    const person = role === "admin" ? null : (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email,is_active) VALUES($1,$2,$3,'Fixture','fixture@example.invalid',$4) RETURNING id", [vendor, id, role === "office" ? "office" : "field", role !== "inactive"])).rows[0].id;
    await pool.query("INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,$3,$4)", [id, vendor, role === "admin" ? "admin" : "member", person]);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    people.push({ id, cookie: buildTestCookie({ ...await resolveContext(user!), userId: id, sv: 1 } as SessionPayload) });
  }
  const task = (await pool.query("INSERT INTO work_hub_tasks(owner_org_type,owner_org_id,title,created_by_id,assignee_user_id) VALUES('vendor',$1,'Distribute workload',$2,$3) RETURNING id,version", [vendor, people[0].id, people[2].id])).rows[0];
  return { vendor, people, task };
}
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("Dashboard task assignment", () => {
  beforeEach(() => notify.mockClear());
  it("lists active company people including both admins, supports office reassignment and records one notification on replay", async () => {
    const f = await fixture();
    const options = await request(app).get(`/work-hub/tasks/${f.task.id}/assignment-options`).set("Cookie", f.people[1].cookie);
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(options.body.people.map((p: { userId: number }) => p.userId).sort()).toEqual(f.people.slice(0, 4).map(p => p.id).sort());
    const body = { operationId: randomUUID(), owner: { type: "vendor", id: f.vendor }, context: { kind: "organization", id: f.vendor }, payloadVersion: 1, expectedVersion: 1, payload: { assigneeUserId: f.people[3].id } };
    const patch = () => request(app).patch(`/work-hub/tasks/${f.task.id}`).set("Cookie", f.people[1].cookie).send(body);
    expect((await patch()).status).toBe(200);
    expect((await patch()).body.replayed).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT assignee_user_id,version FROM work_hub_tasks WHERE id=$1", [f.task.id])).rows[0]).toEqual({ assignee_user_id: f.people[3].id, version: 2 });
  });
  it("rejects foreign and inactive recipients and refuses a non-manager roster read", async () => {
    const f = await fixture(), foreign = await fixture();
    expect((await request(app).get(`/work-hub/tasks/${f.task.id}/assignment-options`).set("Cookie", f.people[2].cookie)).status).toBe(403);
    expect((await request(app).get(`/work-hub/tasks/${foreign.task.id}/assignment-options`).set("Cookie", f.people[0].cookie)).status).toBe(404);
    for (const id of [foreign.people[0].id, f.people[4].id]) {
      const result = await request(app).patch(`/work-hub/tasks/${f.task.id}`).set("Cookie", f.people[0].cookie).send({ operationId: randomUUID(), owner: { type: "vendor", id: f.vendor }, context: { kind: "organization", id: f.vendor }, payloadVersion: 1, expectedVersion: 1, payload: { assigneeUserId: id } });
      expect([403, 404]).toContain(result.status);
    }
    expect(notify).not.toHaveBeenCalled();
  });
  it("allows exactly one concurrent reassignment of the same task version", async () => {
    const f = await fixture();
    const results = await Promise.all([0, 3].map(index => request(app).patch(`/work-hub/tasks/${f.task.id}`).set("Cookie", f.people[1].cookie).send({ operationId: randomUUID(), owner: { type: "vendor", id: f.vendor }, context: { kind: "organization", id: f.vendor }, payloadVersion: 1, expectedVersion: 1, payload: { assigneeUserId: f.people[index].id } })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("requires Resolution for the Dashboard completion action, stores actor/time once and exposes the saved resolution", async () => {
    const f = await fixture();
    const body = { operationId: randomUUID(), owner: { type: "vendor", id: f.vendor }, context: { kind: "organization", id: f.vendor }, payloadVersion: 1, expectedVersion: 1, payload: { action: "complete", resolution: "Radio replaced and verified" } };
    const patch = (value: unknown) => request(app).patch(`/work-hub/tasks/${f.task.id}`).set("Cookie", f.people[1].cookie).send(value);
    expect((await patch({ ...body, payload: { action: "complete" } })).status).toBe(400);
    expect((await pool.query("SELECT status,version FROM work_hub_tasks WHERE id=$1", [f.task.id])).rows[0]).toEqual({ status: "open", version: 1 });
    expect((await patch(body)).status).toBe(200);
    expect((await patch(body)).body.replayed).toBe(true);
    const events = (await pool.query("SELECT actor_user_id,created_at,detail FROM work_hub_task_events WHERE task_id=$1 AND event_type='status.completed'", [f.task.id])).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_user_id: f.people[1].id, detail: { completedById: f.people[1].id, resolution: "Radio replaced and verified" } });
    expect(events[0].created_at).toBeInstanceOf(Date);
    const dashboard = await request(app).get('/work-hub/tasks?dashboard=1').set('Cookie', f.people[1].cookie);
    expect(dashboard.body.tasks.find((row: { id: string }) => row.id === f.task.id)).toMatchObject({ status: "completed", completionResolution: "Radio replaced and verified", completedAt: events[0].created_at.toISOString() });
  });
});
