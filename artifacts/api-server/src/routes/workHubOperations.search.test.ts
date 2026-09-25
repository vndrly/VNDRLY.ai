import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { assetsTable, db, partnersTable, userOrgMembershipsTable, usersTable, vendorsTable, workHubAnnouncementRecipientsTable, workHubAnnouncementsTable, workHubChannelsTable, workHubChannelMembersTable, workHubCollaborationChannelsTable, workHubFilesTable, workHubMessagesTable, workHubNotesTable, workHubTasksTable } from "@workspace/db";
import operations from "./workHubOperations";
import assetRoutes from "./implementationAAssets";
import { buildTestCookie } from "../test-utils/session";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
const app = express().use(express.json()).use(cookieParser()).use(operations).use(assetRoutes);
const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" || process.env.VNDRLY_ISOLATED_TEST_DB === "1";

describe.skipIf(!isolated)("federated Work Hub asset search", () => {
  let viewerId: number;
  let ownerId: number;
  let otherId: number;
  let assetId: string;
  let cookie: string;
  const term = `SearchRadio${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    const suffix = randomUUID();
    const vendors = await db.insert(vendorsTable).values(["A", "B"].map(name => ({ name: `Search ${name} ${suffix}`, contactName: "Fixture", contactEmail: `${name}.${suffix}@example.invalid` }))).returning();
    [ownerId, otherId] = vendors.map(row => row.id);
    const [viewer] = await db.insert(usersTable).values({ username: `search.${suffix}@example.invalid`, displayName: "Search viewer", passwordHash: "fixture-only", role: "vendor" }).returning();
    viewerId = viewer.id;
    await db.insert(userOrgMembershipsTable).values({ userId: viewerId, orgType: "vendor", vendorId: ownerId, role: "member" });
    const [asset] = await db.insert(assetsTable).values({ name: term, category: "Radio", legalOwnerName: "Fixture", responsibleOrgType: "vendor", responsibleOrgId: ownerId }).returning();
    assetId = asset.id;
    await db.insert(assetsTable).values({ name: `${term}Foreign`, category: "Radio", legalOwnerName: "Fixture", responsibleOrgType: "vendor", responsibleOrgId: otherId });
    cookie = buildTestCookie({ userId: viewerId, role: "vendor", vendorId: ownerId, membershipRole: "member" });
  });

  it("returns the authorized asset and exact inventory destination, never the foreign asset", async () => {
    const response = await request(app).get("/work-hub/search").query({ q: term, type: "asset" }).set("Cookie", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.results).toEqual([expect.objectContaining({
      id: `asset:${assetId}`, subjectType: "asset", subjectId: assetId, title: term,
      destination: { module: "files-notes", section: "inventory", assetId },
    })]);
    expect(response.body.cappedSources).toEqual(expect.any(Array));
    expect(JSON.stringify(response.body)).not.toContain(`${term}Foreign`);
    const opened = await request(app).get(`/implementation-a/assets/${assetId}`).set("Cookie", cookie);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ id: assetId, name: term });
  });

  it("rechecks membership for search and exact asset open after a revocation", async () => {
    await db.update(userOrgMembershipsTable).set({ vendorId: otherId }).where(eq(userOrgMembershipsTable.userId, viewerId));
    const search = await request(app).get("/work-hub/search").query({ q: term, type: "asset" }).set("Cookie", cookie);
    expect(search.status).toBe(200);
    expect(search.body.results).toEqual([]);
    const opened = await request(app).get(`/implementation-a/assets/${assetId}`).set("Cookie", cookie);
    expect(opened.status).toBe(404);
  });

  it("opens the exact authorized task and closes it after membership changes", async () => {
    await db.update(userOrgMembershipsTable).set({ vendorId: ownerId }).where(eq(userOrgMembershipsTable.userId, viewerId));
    const [task] = await db.insert(workHubTasksTable).values({ ownerOrgType: "vendor", ownerOrgId: ownerId, title: `${term} task`, createdById: viewerId, assigneeUserId: viewerId }).returning();
    const search = await request(app).get("/work-hub/search").query({ q: term, type: "task" }).set("Cookie", cookie);
    expect(search.status).toBe(200);
    expect(search.body.results).toContainEqual(expect.objectContaining({ subjectId: task.id, destination: { module: "search-item", section: "task", itemId: task.id } }));
    expect((await request(app).get(`/work-hub/search/items/task/${task.id}`).set("Cookie", cookie)).body).toMatchObject({ id: task.id, title: `${term} task` });
    await db.update(userOrgMembershipsTable).set({ vendorId: otherId }).where(eq(userOrgMembershipsTable.userId, viewerId));
    const revokedSearch = await request(app).get("/work-hub/search").query({ q: term, type: "task" }).set("Cookie", cookie);
    expect(revokedSearch.body.results).toEqual([]);
    expect((await request(app).get(`/work-hub/search/items/task/${task.id}`).set("Cookie", cookie)).status).toBe(404);
  });

  it("pages every inventory asset across a microsecond-precision timestamp tie", async () => {
    await db.update(userOrgMembershipsTable).set({ vendorId: ownerId }).where(eq(userOrgMembershipsTable.userId, viewerId));
    const pageTerm = `Precision${randomUUID().replaceAll("-", "")}`;
    const inserted = await db.insert(assetsTable).values(Array.from({ length: 105 }, (_, index) => ({
      name: `${pageTerm}-${index}`, category: "Radio", legalOwnerName: "Fixture",
      responsibleOrgType: "vendor", responsibleOrgId: ownerId,
    }))).returning({ id: assetsTable.id });
    await db.update(assetsTable).set({ updatedAt: sql`'2026-09-24 12:30:40.123456+00'::timestamptz` })
      .where(inArray(assetsTable.id, inserted.map(row => row.id)));
    const first = await request(app).get("/work-hub/search").query({ q: pageTerm, type: "asset" }).set("Cookie", cookie);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.results).toHaveLength(100);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(JSON.parse(Buffer.from(first.body.nextCursor, "base64url").toString("utf8")).updatedAt)
      .toBe("2026-09-24T12:30:40.123456Z");
    const second = await request(app).get("/work-hub/search").query({ q: pageTerm, type: "asset", cursor: first.body.nextCursor }).set("Cookie", cookie);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.results).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    expect(new Set([...first.body.results, ...second.body.results].map((row: { subjectId: string }) => row.subjectId)))
      .toEqual(new Set(inserted.map(row => row.id)));
  });

  it("finds partner channel content under a vendor cookie and fails closed when partner membership is revoked", async () => {
    const suffix = randomUUID();
    const [partner] = await db.insert(partnersTable).values({ name: `Search Partner ${suffix}`, contactName: "Fixture", contactEmail: `${suffix}@example.invalid` }).returning();
    const [membership] = await db.insert(userOrgMembershipsTable).values({ userId: viewerId, orgType: "partner", partnerId: partner.id, role: "member" }).returning();
    const [channel] = await db.insert(workHubChannelsTable).values({ ownerOrgType: "partner", ownerOrgId: partner.id, contextKind: "organization", contextId: String(partner.id), name: `Partner ${suffix}`, createdById: viewerId }).returning();
    const content = `CrossOwner${suffix.replaceAll("-", "")}`;
    const [message] = await db.insert(workHubMessagesTable).values({ channelId: channel.id, authorUserId: viewerId, body: content, clientOperationId: randomUUID() }).returning();
    const [note] = await db.insert(workHubNotesTable).values({ channelId: channel.id, title: content, body: content, createdById: viewerId, updatedById: viewerId }).returning();
    const [file] = await db.insert(workHubFilesTable).values({ ownerOrgType: "partner", ownerOrgId: partner.id, channelId: channel.id, uploadedById: viewerId,
      storageKey: `search-fixture/${suffix}`, fileName: `${content}.txt`, contentType: "text/plain", byteSize: 1, checksumSha256: "0".repeat(64), state: "finalized", finalizedAt: new Date() }).returning();
    const [announcement] = await db.insert(workHubAnnouncementsTable).values({ ownerOrgType: "partner", ownerOrgId: partner.id, channelId: channel.id,
      title: content, body: content, publishedById: viewerId }).returning();
    await db.insert(workHubAnnouncementRecipientsTable).values({ announcementId: announcement.id, userId: viewerId });
    const linked = [["message", message.id], ["note", note.id], ["file", file.id], ["announcement", announcement.id]] as const;
    for (const [type, id] of linked) {
      const found = await request(app).get("/work-hub/search").query({ q: content, type }).set("Cookie", cookie);
      expect(found.status, JSON.stringify(found.body)).toBe(200);
      expect(found.body.results).toContainEqual(expect.objectContaining({ subjectType: type, subjectId: id }));
      expect((await request(app).get(`/work-hub/search/items/${type}/${id}`).set("Cookie", cookie)).status).toBe(200);
    }
    await db.delete(userOrgMembershipsTable).where(eq(userOrgMembershipsTable.id, membership.id));
    for (const [type, id] of linked) {
      const found = await request(app).get("/work-hub/search").query({ q: content, type }).set("Cookie", cookie);
      expect(found.body.results).not.toContainEqual(expect.objectContaining({ subjectId: id }));
      expect((await request(app).get(`/work-hub/search/items/${type}/${id}`).set("Cookie", cookie)).status).toBe(404);
    }
    await db.insert(workHubCollaborationChannelsTable).values({ channelId: channel.id, kind: "shared" });
    await db.insert(workHubChannelMembersTable).values({ channelId: channel.id, userId: viewerId, mode: "member" });
    expect((await request(app).get(`/work-hub/search/items/message/${message.id}`).set("Cookie", cookie)).status).toBe(200);
  });
});
