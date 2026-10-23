import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, vendorsTable, usersTable, userOrgMembershipsTable, workHubTasksTable, workHubTaskEventsTable } from "@workspace/db";
import operations from "./workHubOperations";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(operations);
const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local";

describe.skipIf(!isolated)("Dashboard personal and company task projection", () => {
  let vendorId: number, adminId: number, workerId: number, taskId: string, adminCookie: string;
  beforeAll(async () => {
    const suffix = randomUUID();
    const vendors = await db.insert(vendorsTable).values(["A", "B"].map(name => ({ name: `Task dashboard ${name} ${suffix}`, contactName: "Fixture", contactEmail: `${name}.${suffix}@example.invalid` }))).returning();
    vendorId = vendors[0].id;
    const users = await db.insert(usersTable).values(["Admin", "Worker"].map(name => ({ username: `tasks.${name}.${suffix}@example.invalid`, displayName: name, passwordHash: "fixture-only", role: "vendor" }))).returning();
    [adminId, workerId] = users.map(user => user.id);
    await db.insert(userOrgMembershipsTable).values([{ userId: adminId, orgType: "vendor", vendorId, role: "admin" }, { userId: workerId, orgType: "vendor", vendorId, role: "member" }]);
    const tasks = await db.insert(workHubTasksTable).values(Array.from({ length: 105 }, (_, index) => ({ ownerOrgType: "vendor", ownerOrgId: vendorId, title: `Fixture ${index}`, createdById: adminId, assigneeUserId: index === 0 ? adminId : workerId }))).returning();
    taskId = tasks[0].id;
    await db.insert(workHubTasksTable).values({ ownerOrgType: "vendor", ownerOrgId: vendors[1].id, title: "Foreign company task", createdById: adminId, assigneeUserId: workerId });
    adminCookie = buildTestCookie({ userId: adminId, role: "vendor", vendorId, membershipRole: "admin" });
  });
  it("pages all company tasks with assignee names and never includes another company", async () => {
    const first = await request(app).get("/work-hub/tasks?dashboard=1").set("Cookie", adminCookie);
    expect(first.status).toBe(200); expect(first.body.scope).toBe("company"); expect(first.body.tasks).toHaveLength(100);
    const second = await request(app).get("/work-hub/tasks").query({ dashboard: "1", cursor: first.body.nextCursor }).set("Cookie", adminCookie);
    expect(second.body.tasks).toHaveLength(5); expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.tasks, ...second.body.tasks];
    expect(new Set(all.map(task => task.id)).size).toBe(105);
    expect(all.every(task => task.ownerOrgId === vendorId && ["Admin", "Worker"].includes(task.assigneeName))).toBe(true);
  });
  it("keeps gatekeepers and gate supervisors personal, while office gets company totals", async () => {
    for (const vendorRole of ["gatekeeper", "gate_supervisor", "office"]) {
      const cookie = buildTestCookie({ userId: adminId, role: "vendor", vendorId, membershipRole: "member", vendorRole });
      const result = await request(app).get("/work-hub/tasks?dashboard=1").set("Cookie", cookie);
      expect(result.body.scope).toBe(vendorRole === "office" ? "company" : "self");
      if (vendorRole !== "office") expect(result.body.tasks.map((task: { id: string }) => task.id)).toEqual([taskId]);
    }
    expect((await request(app).get("/work-hub/tasks?dashboard=1&cursor=bad").set("Cookie", adminCookie)).status).toBe(400);
    expect((await request(app).get("/work-hub/tasks?dashboard=1")).status).toBe(401);
  });
  it("opens an exact task beyond the list cap, and completion is not moved by later edits", async () => {
    const update = async (expectedVersion: number, payload: object) => request(app).patch(`/work-hub/tasks/${taskId}`).set("Cookie", adminCookie).send({ operationId: randomUUID(), payloadVersion: 1, expectedVersion, owner: { type: "vendor", id: vendorId }, context: { kind: "organization", id: vendorId }, payload });
    const completed = await update(1, { status: "completed" });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    const edited = await update(completed.body.resource.version, { status: "completed", title: "Completed and edited" });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const events = await db.select().from(workHubTaskEventsTable).where(eq(workHubTaskEventsTable.taskId, taskId));
    expect(events.filter(event => event.eventType === "status.completed")).toHaveLength(1);
    const opened = await request(app).get("/work-hub/tasks").query({ task: taskId }).set("Cookie", adminCookie);
    expect(opened.body).toHaveLength(1); expect(opened.body[0].title).toBe("Completed and edited");
    const projection = await request(app).get("/work-hub/tasks?dashboard=1").set("Cookie", buildTestCookie({ userId: adminId, role: "vendor", vendorId, membershipRole: "member", vendorRole: "gatekeeper" }));
    expect(projection.body.tasks[0].completedAt).toBe(events.find(event => event.eventType === "status.completed")!.createdAt.toISOString());
  });
});
