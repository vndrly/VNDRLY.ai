import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";

const state = vi.hoisted(() => ({ task: { id: "a", ownerOrgType: "vendor", ownerOrgId: 7, channelId: null, assigneeUserId: null as number | null, createdById: 99, status: "open", version: 1, gateHopper: null }, writes: [] as Record<string, unknown>[] }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("./notifications", () => ({ notifyUsers: vi.fn() }));
vi.mock("../work-hub/owner-users", () => ({ assertOwnerUsers: vi.fn(async () => undefined), assertOwnerMatchesChannel: vi.fn() }));
vi.mock("../assistant/chatgpt-grant-store", async importOriginal => ({ ...await importOriginal<typeof import("../assistant/chatgpt-grant-store")>(), validateAssistantSession: async (session: unknown) => session }));
vi.mock("../work-hub/commands", () => ({ executeWorkHubCommand: async (_actor: unknown, _kind: unknown, _envelope: unknown, work: (tx: unknown) => Promise<unknown>) => {
  const query = { from() { return this; }, where() { return this; }, limit() { return this; }, for: async () => [state.task] };
  const tx = {
    select: () => query,
    insert: () => ({ values(value: Record<string, unknown>) { state.writes.push(value); return { returning: async () => [{ ...state.task, ...value }] }; } }),
    update: () => ({ set: (value: Record<string, unknown>) => ({ where: () => ({ returning: async () => [{ ...state.task, ...value }] }) }) }),
  };
  return { resource: await work(tx), replayed: false };
} }));
import operations from "./workHubOperations";
const app = express().use(express.json()).use(cookieParser()).use(operations);
const cookie = (vendorRole: string, vendorId = 7) => buildTestCookie({ userId: 3, role: "vendor", vendorId, membershipRole: "member", vendorRole });
const command = (payload: object) => ({ operationId: randomUUID(), owner: { type: "vendor", id: 7 }, context: { kind: "organization", id: 7 }, payloadVersion: 1, expectedVersion: 1, payload });

describe("Task hopper routes", () => {
  beforeEach(() => { state.writes.length = 0; state.task.assigneeUserId = null; state.task.status = "open"; });
  it("creates a gatekeeper's task unassigned and rejects an assigned or foreign-company request", async () => {
    const created = await request(app).post("/work-hub/tasks").set("Cookie", cookie("gatekeeper")).send(command({ title: "Repair gate", assigneeUserId: null }));
    expect(created.status, created.text).toBe(201);
    expect(created.body.resource).toMatchObject({ assigneeUserId: null, ownerOrgId: 7, createdById: 3 });
    const before = state.writes.length;
    expect((await request(app).post("/work-hub/tasks").set("Cookie", cookie("gatekeeper")).send(command({ title: "No", assigneeUserId: 4 }))).status).toBe(403);
    expect((await request(app).post("/work-hub/tasks").set("Cookie", cookie("gatekeeper", 8)).send(command({ title: "No" }))).status).toBe(404);
    expect(state.writes).toHaveLength(before);
  });
  it("allows office staff to assign and another company member to complete a hopper task with a resolution", async () => {
    const created = await request(app).post("/work-hub/tasks").set("Cookie", cookie("office")).send(command({ title: "Inspect", assigneeUserId: 4 }));
    expect(created.status, created.text).toBe(201);
    const complete = await request(app).patch("/work-hub/tasks/a").set("Cookie", cookie("field")).send(command({ action: "complete", resolution: "Barrier repaired" }));
    expect(complete.status, complete.text).toBe(200);
    expect(complete.body.resource.status).toBe("completed");
    expect(state.writes.some(row => row.eventType === "status.completed" && (row.detail as any)?.completedById === 3)).toBe(true);
  });
  it("does not allow a different employee to complete an assigned task or bypass the company boundary", async () => {
    state.task.assigneeUserId = 4;
    const body = command({ action: "complete", resolution: "Done" });
    expect((await request(app).patch("/work-hub/tasks/a").set("Cookie", cookie("field")).send(body)).status).toBe(403);
    state.task.assigneeUserId = null;
    expect((await request(app).patch("/work-hub/tasks/a").set("Cookie", cookie("field", 8)).send(body)).status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });
});
