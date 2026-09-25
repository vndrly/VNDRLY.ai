import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, usersTable, vendorsTable, userOrgMembershipsTable, workHubChannelsTable, workHubNotesTable, workHubNoteVersionsTable } from "@workspace/db";
import channels from "./workHubChannels";
import { buildTestCookie } from "../test-utils/session";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(channels);

describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("channel note edit authority", () => {
  let ownerId: number, channelId: string, authorId: number, otherId: number, supervisorId: number, adminId: number;
  let author: string, other: string, supervisor: string, admin: string;
  const envelope = (payload: unknown, expectedVersion: number) => ({ owner: { type: "vendor", id: ownerId }, context: { kind: "organization", id: ownerId }, payloadVersion: 1, operationId: randomUUID(), expectedVersion, payload });
  const edit = (noteId: string, cookie: string, version = 1) => request(app).patch(`/work-hub/channels/${channelId}/notes/${noteId}`).set("Cookie", cookie).send(envelope({ title: "Updated", body: "Changed" }, version));
  const note = async (at = new Date()) => (await db.insert(workHubNotesTable).values({ channelId, title: "Original", body: "First", createdById: authorId, updatedById: authorId, createdAt: at, updatedAt: at }).returning())[0]!;

  beforeAll(async () => {
    const suffix = randomUUID();
    ownerId = (await db.insert(vendorsTable).values({ name: `Note owner ${suffix}`, contactName: "Test", contactEmail: `${suffix}@example.invalid` }).returning())[0]!.id;
    const people = await db.insert(usersTable).values(["author", "other", "supervisor", "admin"].map(name => ({ username: `${name}.${suffix}`, displayName: name, passwordHash: "unused-test-hash", role: "vendor" as const }))).returning();
    [authorId, otherId, supervisorId, adminId] = people.map(person => person.id) as [number, number, number, number];
    await db.insert(userOrgMembershipsTable).values(people.map((person, index) => ({ userId: person.id, orgType: "vendor" as const, vendorId: ownerId, role: index === 3 ? "admin" as const : "member" as const })));
    channelId = (await db.insert(workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, contextKind: "organization", contextId: String(ownerId), name: "Notes", visibility: "organization", createdById: adminId }).returning())[0]!.id;
    author = buildTestCookie({ userId: authorId, role: "vendor", vendorId: ownerId, membershipRole: "member" });
    other = buildTestCookie({ userId: otherId, role: "vendor", vendorId: ownerId, membershipRole: "member" });
    supervisor = buildTestCookie({ userId: supervisorId, role: "vendor", vendorId: ownerId, membershipRole: "member", vendorRole: "gate_supervisor" });
    admin = buildTestCookie({ userId: adminId, role: "vendor", vendorId: ownerId, membershipRole: "admin" });
  });

  it("denies a channel writer editing another author's note without changing history", async () => {
    const current = await note();
    expect((await edit(current.id, other)).status).toBe(403);
    expect((await db.select().from(workHubNotesTable).where(eq(workHubNotesTable.id, current.id)))[0]!.version).toBe(1);
    expect(await db.select().from(workHubNoteVersionsTable).where(eq(workHubNoteVersionsTable.noteId, current.id))).toHaveLength(0);
  });

  it("allows the author just before the 15-minute cutoff and rejects at the cutoff", async () => {
    const within = await note(new Date(Date.now() - 14 * 60_000 - 58_000));
    expect((await edit(within.id, author)).status).toBe(200);
    const expired = await note(new Date(Date.now() - 15 * 60_000 - 1_000));
    expect((await edit(expired.id, author)).status).toBe(403);
  });

  it("allows scoped supervisor and organization admin edits after the author cutoff", async () => {
    const supervised = await note(new Date(Date.now() - 16 * 60_000));
    expect((await edit(supervised.id, supervisor)).status).toBe(200);
    const managed = await note(new Date(Date.now() - 16 * 60_000));
    expect((await edit(managed.id, admin)).status).toBe(200);
  });
});
