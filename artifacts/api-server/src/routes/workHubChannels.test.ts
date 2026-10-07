import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, usersTable, vendorsTable, partnersTable, userOrgMembershipsTable, workHubChannelsTable, workHubChannelMembersTable, workHubCollaborationChannelsTable, workHubNotesTable, workHubNoteVersionsTable, workHubMessagesTable } from "@workspace/db";
import channels from "./workHubChannels";
import { buildTestCookie } from "../test-utils/session";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(channels);

describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("channel note edit authority", () => {
  let ownerId: number, channelId: string, authorId: number, otherId: number, supervisorId: number, adminId: number;
  let author: string, other: string, supervisor: string, admin: string;
  const envelope = (payload: unknown, expectedVersion: number | null) => ({ owner: { type: "vendor", id: ownerId }, context: { kind: "organization", id: ownerId }, payloadVersion: 1, operationId: randomUUID(), expectedVersion, payload });
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

  it("retains nested reply ancestry, one exact replay, and rejects a foreign parent", async () => {
    const path = `/work-hub/channels/${channelId}/messages`;
    const send = (payload: Record<string, unknown>, operationId = randomUUID()) => {
      const body = { ...envelope(payload, null), operationId };
      return { body, request: () => request(app).post(path).set("Cookie", author).send(body) };
    };
    const a = await send({ body: "Synthetic root A" }).request();
    expect(a.status).toBe(201);
    const rootId = a.body.resource.id;
    const b = await send({ body: "Synthetic reply B", parentMessageId: rootId }).request();
    expect(b.status).toBe(201);
    expect(b.body.resource.rootMessageId).toBe(rootId);
    const cRequest = send({ body: "Synthetic nested C", parentMessageId: b.body.resource.id });
    const c = await cRequest.request();
    expect(c.status).toBe(201);
    expect(c.body.resource).toMatchObject({ parentMessageId: b.body.resource.id, rootMessageId: rootId });
    const replay = await cRequest.request();
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.resource).toEqual(c.body.resource);
    await db.update(workHubMessagesTable).set({ deletedAt: new Date() }).where(eq(workHubMessagesTable.id, c.body.resource.id));
    expect((await cRequest.request()).body.resource).toEqual(c.body.resource);
    const [tombstone] = await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.id, c.body.resource.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    const saved = await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.clientOperationId, cRequest.body.operationId));
    expect(saved).toHaveLength(1);
    const list = await request(app).get(path).set("Cookie", author);
    expect(list.status).toBe(200);
    const thread = list.body.filter((row: { id: string; rootMessageId: string | null }) => row.id === rootId || row.rootMessageId === rootId);
    expect(thread.map((row: { id: string }) => row.id).sort()).toEqual([rootId, b.body.resource.id, c.body.resource.id].sort());
    for (const historicalRoot of [null, b.body.resource.id]) {
      await db.update(workHubMessagesTable).set({ rootMessageId: historicalRoot }).where(eq(workHubMessagesTable.id, b.body.resource.id));
      const legacyRequest = send({ body: "Reply to legacy ancestry", parentMessageId: b.body.resource.id });
      const accepted = await legacyRequest.request();
      expect(accepted.status).toBe(201);
      expect(accepted.body.resource).toMatchObject({ parentMessageId: b.body.resource.id, rootMessageId: rootId });
      const retried = await legacyRequest.request();
      expect(retried.status).toBe(200);
      expect(retried.body.resource).toEqual(accepted.body.resource);
      expect(await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.clientOperationId, legacyRequest.body.operationId))).toHaveLength(1);
      const [unchanged] = await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.id, b.body.resource.id));
      expect(unchanged!.rootMessageId).toBe(historicalRoot);
    }
    const [foreignChannel] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, contextKind: "organization", contextId: randomUUID(), name: "Separate thread", visibility: "private", createdById: otherId }).returning();
    const [foreign] = await db.insert(workHubMessagesTable).values({ channelId: foreignChannel!.id, authorUserId: otherId, body: "Private parent", kind: "text", clientOperationId: randomUUID() }).returning();
    const denied = send({ body: "Must not save", parentMessageId: foreign!.id });
    expect((await denied.request()).status).toBe(404);
    expect(await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.clientOperationId, denied.body.operationId))).toHaveLength(0);
    expect((await send({ body: "Synthetic nested C", parentMessageId: foreign!.id }, cRequest.body.operationId).request()).status).toBe(404);
    expect((await send({ body: "Changed replay body", parentMessageId: b.body.resource.id }, cRequest.body.operationId).request()).status).toBe(403);
    const [otherChannel] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, contextKind: "organization", contextId: randomUUID(), name: "Other accessible channel", visibility: "organization", createdById: adminId }).returning();
    expect((await request(app).post(`/work-hub/channels/${otherChannel!.id}/messages`).set("Cookie", author).send(cRequest.body)).status).toBe(404);
    expect((await request(app).post(`/work-hub/channels/${otherChannel!.id}/messages`).set("Cookie", author).send({ ...cRequest.body, payload: { body: "Synthetic nested C" } })).status).toBe(403);
    const mismatched = send({ body: "Wrong root", parentMessageId: b.body.resource.id, rootMessageId: b.body.resource.id });
    expect((await mismatched.request()).status).toBe(403);
    expect(await db.select().from(workHubMessagesTable).where(eq(workHubMessagesTable.clientOperationId, mismatched.body.operationId))).toHaveLength(0);
  });

  it("reads an exact message beyond the list page and refuses a different channel or nonparticipant",async()=>{
    const privateChannel=(await db.insert(workHubChannelsTable).values({ownerOrgType:'vendor',ownerOrgId:ownerId,contextKind:'organization',contextId:randomUUID(),name:'Private exact message',visibility:'private',createdById:authorId}).returning())[0]!;
    await db.insert(workHubChannelMembersTable).values({channelId:privateChannel.id,userId:authorId,mode:'owner'});
    const messages=await db.insert(workHubMessagesTable).values(Array.from({length:105},(_,i)=>({channelId:privateChannel.id,authorUserId:authorId,body:`Recorded ${i}`,kind:'text',clientOperationId:randomUUID(),createdAt:new Date(Date.now()-i*1000)}))).returning();
    const target=messages.at(-1)!;
    const exact=await request(app).get(`/work-hub/channels/${privateChannel.id}/messages/${target.id}`).set('Cookie',author);
    expect(exact.status).toBe(200);expect(exact.body).toMatchObject({source:'vndrly',authority:'work_hub_message',channel:{id:privateChannel.id,ownerOrgId:ownerId},message:{id:target.id,body:target.body}});
    expect((await request(app).get(`/work-hub/channels/${channelId}/messages/${target.id}`).set('Cookie',author)).status).toBe(404);
    expect((await request(app).get(`/work-hub/channels/${privateChannel.id}/messages/${target.id}`).set('Cookie',other)).status).toBe(404);
    await db.update(workHubMessagesTable).set({deletedAt:new Date()}).where(eq(workHubMessagesTable.id,target.id));
    const deleted=await request(app).get(`/work-hub/channels/${privateChannel.id}/messages/${target.id}`).set('Cookie',author);expect(deleted.body.message.body).toBe('');
  });

  it.each([false, true])("paginates six-digit channel timestamps exactly once with managed filtering=%s", async (managed) => {
    const prefix = randomUUID().slice(0, 8);
    const fixture = Array.from({ length: 210 }, (_, index) => ({
      id: `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ownerOrgType: "vendor", ownerOrgId: index % 2 === 0 ? ownerId : ownerId + 100000,
      contextKind: "organization", contextId: `${ownerId}:${prefix}:${index}`, name: `Precision ${index}`,
      visibility: "organization", createdById: authorId,
      updatedAt: sql`'2026-09-24T12:00:00.123456Z'::timestamptz`,
    }));
    await db.insert(workHubChannelsTable).values(fixture);
    await db.insert(workHubChannelMembersTable).values(fixture.map(channel => ({ channelId: channel.id, userId: authorId, mode: "member" })));
    const token = managed ? buildTestCookie({ userId: authorId, role: "field_employee", vendorId: ownerId, managedSubcontractor: { siteGrants: [{ siteId: 1, role: "gatekeeper" }] } }) : author;
    const found: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await request(app).get("/work-hub/channels").query({ limit: 100, ...(cursor ? { cursor } : {}) }).set("Cookie", token);
      expect(response.status).toBe(200);
      found.push(...response.body.map((row: any) => row.id).filter((id: string) => id.startsWith(prefix)));
      if (response.body.length < 100) break;
      cursor = response.body.at(-1).continuationCursor;
      expect(cursor).toEqual(expect.any(String));
    }
    const expected = fixture.filter(row => !managed || row.ownerOrgId === ownerId).map(row => row.id).sort();
    expect(found.sort()).toEqual(expected);
    expect(new Set(found).size).toBe(found.length);
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

  it("lets collaboration members create and edit their own notes but not another member's", async () => {
    const [shared] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, contextKind: "organization", contextId: `${ownerId}:shared:${randomUUID()}`, name: "Shared notes", visibility: "private", createdById: adminId }).returning();
    await db.insert(workHubCollaborationChannelsTable).values({ channelId: shared!.id, kind: "shared" });
    await db.insert(workHubChannelMembersTable).values([
      { channelId: shared!.id, userId: authorId, mode: "member" },
      { channelId: shared!.id, userId: otherId, mode: "member" },
    ]);
    const created = await request(app).post(`/work-hub/channels/${shared!.id}/notes`).set("Cookie", author).send(envelope({ title: "Shared", body: "First" }, null));
    expect(created.status).toBe(201);
    const noteId = created.body.resource.id as string;
    expect((await request(app).patch(`/work-hub/channels/${shared!.id}/notes/${noteId}`).set("Cookie", other).send(envelope({ title: "Other", body: "No" }, 1))).status).toBe(403);
    expect((await request(app).patch(`/work-hub/channels/${shared!.id}/notes/${noteId}`).set("Cookie", author).send(envelope({ title: "Author", body: "Updated" }, 1))).status).toBe(200);
  });

  it("uses the partner channel owner for an invited vendor writer and denies replay after invitation revocation", async () => {
    const [partner] = await db.insert(partnersTable).values({ name: `Shared partner ${randomUUID()}`, contactName: "Test", contactEmail: "partner@example.invalid" }).returning();
    const [shared] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "partner", ownerOrgId: partner!.id, contextKind: "organization", contextId: String(partner!.id), name: "Partner shared", visibility: "private", createdById: adminId }).returning();
    await db.insert(workHubCollaborationChannelsTable).values({ channelId: shared!.id, kind: "shared" });
    await db.insert(workHubChannelMembersTable).values({ channelId: shared!.id, userId: authorId, mode: "member" });
    const body = { ...envelope({ title: "Vendor contribution", body: "Partner-owned note" }, null), owner: { type: "partner", id: partner!.id }, context: { kind: "organization", id: partner!.id } };
    const path = `/work-hub/channels/${shared!.id}/notes`;
    // Using the active vendor owner must remain forbidden, even when invited.
    expect((await request(app).post(path).set("Cookie", author).send(envelope(body.payload, null))).status).toBe(403);
    const created = await request(app).post(path).set("Cookie", author).send(body);
    expect(created.status).toBe(201);
    expect((await request(app).post(path).set("Cookie", author).send(body)).body.resource.id).toBe(created.body.resource.id);
    const edited = { ...body, operationId: randomUUID(), expectedVersion: 1, payload: { title: "Revised", body: "Same owner" } };
    expect((await request(app).patch(`${path}/${created.body.resource.id}`).set("Cookie", author).send(edited)).status).toBe(200);
    await db.delete(workHubChannelMembersTable).where(and(eq(workHubChannelMembersTable.channelId, shared!.id), eq(workHubChannelMembersTable.userId, authorId)));
    expect((await request(app).post(path).set("Cookie", author).send(body)).status).toBe(404);
    expect((await request(app).patch(`${path}/${created.body.resource.id}`).set("Cookie", author).send(edited)).status).toBe(404);
    expect(await db.select().from(workHubNotesTable).where(eq(workHubNotesTable.channelId, shared!.id))).toHaveLength(1);
    expect(await db.select().from(workHubNoteVersionsTable).where(eq(workHubNoteVersionsTable.noteId, created.body.resource.id))).toHaveLength(1);
  });
});
