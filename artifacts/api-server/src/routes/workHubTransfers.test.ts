import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, usersTable, vendorsTable, userOrgMembershipsTable, workHubTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import transfers from "./workHubTransfers";
import { buildTestCookie } from "../test-utils/session";
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(transfers);
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("CSV import preview and confirmation", () => {
  let adminCookie: string, memberCookie: string, foreignCookie: string, owner: number, batchId: string;
  const source = `Transfer ${randomUUID()}`;
  beforeAll(async () => {
    const suffix = randomUUID();
    const orgs = await db.insert(vendorsTable).values(["A", "B"].map(name => ({ name: `Transfer ${name} ${suffix}`, contactName: "Test", contactEmail: `${name}.${suffix}@example.invalid` }))).returning();
    owner = orgs[0]!.id;
    const people = await db.insert(usersTable).values(["Admin", "Member", "Foreign"].map(name => ({ username: `${name}.${suffix}@example.invalid`, displayName: name, passwordHash: "unused", role: "vendor" }))).returning();
    await db.insert(userOrgMembershipsTable).values(people.map((p, i) => ({ userId: p.id, orgType: "vendor", vendorId: orgs[i === 2 ? 1 : 0]!.id, role: i === 1 ? "member" : "admin" })));
    [adminCookie, memberCookie, foreignCookie] = people.map((p, i) => buildTestCookie({ userId: p.id, role: "vendor", vendorId: orgs[i === 2 ? 1 : 0]!.id, membershipRole: "admin" })) as [string, string, string];
  });
  const rows = [{ externalId: "one", title: "Imported task", body: "Review work" }, { externalId: "two", title: "", body: "Invalid" }, { externalId: "one", title: "Duplicate row" }];
  it("rejects unauthenticated and stale admin claims, preview creates no task", async () => {
    const body = { operationId: randomUUID(), source, category: "tasks", rows };
    expect((await request(app).post("/work-hub/transfers/preview").send(body)).status).toBe(401);
    expect((await request(app).post("/work-hub/transfers/preview").set("Cookie", memberCookie).send(body)).status).toBe(403);
    const preview = await request(app).post("/work-hub/transfers/preview").set("Cookie", adminCookie).send(body);
    expect(preview.status).toBe(201); batchId = preview.body.batch.id;
    expect(preview.body.items.map((r: any) => r.status)).toEqual(["staged", "error", "error"]);
    expect(await db.select().from(workHubTasksTable).where(eq(workHubTasksTable.ownerOrgId, owner))).toHaveLength(0);
  });
  it("requires explicit confirmation and keeps imports isolated and idempotent", async () => {
    const op = randomUUID();
    expect((await request(app).post(`/work-hub/transfers/${batchId}/apply`).set("Cookie", adminCookie).send({ operationId: op })).status).toBe(400);
    expect((await request(app).post(`/work-hub/transfers/${batchId}/apply`).set("Cookie", foreignCookie).send({ operationId: op, confirm: true })).status).toBe(404);
    const first = await request(app).post(`/work-hub/transfers/${batchId}/apply`).set("Cookie", adminCookie).send({ operationId: op, confirm: true });
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ imported: 1, errors: 2 });
    const replay = await request(app).post(`/work-hub/transfers/${batchId}/apply`).set("Cookie", adminCookie).send({ operationId: op, confirm: true });
    expect(replay.body.imported).toBe(1);
    expect(await db.select().from(workHubTasksTable).where(eq(workHubTasksTable.ownerOrgId, owner))).toHaveLength(1);
  });
  it("deduplicates later batches by stable external ID", async () => {
    const preview = await request(app).post("/work-hub/transfers/preview").set("Cookie", adminCookie).send({ operationId: randomUUID(), source, category: "tasks", rows: [rows[0]] });
    expect(preview.body.items[0].status).toBe("duplicate");
    const applied = await request(app).post(`/work-hub/transfers/${preview.body.batch.id}/apply`).set("Cookie", adminCookie).send({ operationId: randomUUID(), confirm: true });
    expect(applied.body).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await db.select().from(workHubTasksTable).where(eq(workHubTasksTable.ownerOrgId, owner))).toHaveLength(1);
  });
});
