import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1")("message mutation exact retry and atomic version", () => {
  it("serializes competing edits, preserves exact receipts and denies changed targets/current authority", async () => {
    const { assertFreshLocalTestDatabaseEnvironment } = await import("../../../../scripts/fresh-test-database.mjs");
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const d = await import("@workspace/db");
    const identity = await d.pool.query("select current_database() as name,host(inet_server_addr()) as address,inet_server_port() as port");
    const configured = new URL(process.env.DATABASE_URL!);
    expect(identity.rows[0].name).toBe(decodeURIComponent(configured.pathname.slice(1)));
    expect(["127.0.0.1", "::1"]).toContain(identity.rows[0].address);
    expect(identity.rows[0].port).toBe(Number(configured.port || 5432));
    const { eq } = await import("drizzle-orm");
    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const request = (await import("supertest")).default;
    const router = (await import("./workHubChannels")).default;
    const { resolveContext } = await import("./auth");
    const { buildTestCookie } = await import("../test-utils/session");
    const tag = randomUUID();
    const [vendor] = await d.db.insert(d.vendorsTable).values({ name: "Synthetic messages " + tag, contactName: "Synthetic", contactEmail: tag + "@example.invalid" }).returning();
    const [foreignVendor] = await d.db.insert(d.vendorsTable).values({ name: "Synthetic foreign messages " + tag, contactName: "Synthetic", contactEmail: "foreign-" + tag + "@example.invalid" }).returning();
    const actors = [];
    for (const [index, company] of [vendor, vendor, foreignVendor].entries()) {
      const [user] = await d.db.insert(d.usersTable).values({ username: `synthetic-message-${index}-${tag}`, passwordHash: "unusable-test-hash", displayName: "Synthetic message actor", role: "vendor" }).returning();
      const [membership] = await d.db.insert(d.userOrgMembershipsTable).values({ userId: user.id, orgType: "vendor", vendorId: company.id, role: "member" }).returning();
      actors.push({ user, membership, cookie: buildTestCookie({ ...(await resolveContext(user)), userId: user.id, sv: user.sessionVersion }) });
    }
    const [author, coworker, foreign] = actors;
    const channels = [];
    const contexts = [
      { contextKind: "organization", contextId: String(vendor.id), visibility: "organization" },
      { contextKind: "chat", contextId: randomUUID(), visibility: "private" },
    ];
    for (const [index, context] of contexts.entries()) {
      const [channel] = await d.db.insert(d.workHubChannelsTable).values({ ownerOrgType: "vendor", ownerOrgId: vendor.id, ...context, name: "Synthetic mutation " + index, createdById: author.user.id }).returning();
      channels.push(channel);
    }
    // The second context is a real private conversation with an explicit writer,
    // rather than a duplicate organization channel or a fabricated owner ID.
    await d.db.insert(d.workHubChannelMembersTable).values({ channelId: channels[1].id, userId: author.user.id, mode: "member" });
    const [message, other] = await d.db.insert(d.workHubMessagesTable).values([
      { channelId: channels[0].id, authorUserId: author.user.id, body: "Synthetic original", kind: "text", clientOperationId: randomUUID() },
      { channelId: channels[1].id, authorUserId: author.user.id, body: "Synthetic second", kind: "text", clientOperationId: randomUUID() },
    ]).returning();
    const app = express().use(express.json()).use(cookieParser()).use(router);
    expect((await request(app).get(`/work-hub/channels/${channels[1].id}/messages`).set("Cookie", author.cookie)).status).toBe(200);
    const path = `/work-hub/channels/${channels[0].id}/messages/${message.id}`;
    const command = (body: string, expectedVersion: number, operationId = randomUUID()) => ({ operationId, payloadVersion: 1, expectedVersion, owner: { type: "vendor", id: vendor.id }, context: { kind: "organization", id: vendor.id }, payload: { body } });
    const edits = [command("Synthetic first edit", 1), command("Synthetic competing edit", 1)];
    const responses = await Promise.all(edits.map(body => request(app).patch(path).set("Cookie", author.cookie).send(body)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(r => r.status === 200);
    const replay = await request(app).patch(path).set("Cookie", author.cookie).send(edits[winner]);
    expect(replay.status).toBe(200);
    expect(replay.body.resource).toEqual(responses[winner].body.resource);
    expect((await request(app).patch(path).set("Cookie", author.cookie).send({ ...edits[winner], payload: { body: "Changed same-operation text" } })).status).toBe(403);
    const otherContext = { kind: "chat", id: channels[1].contextId };
    expect((await request(app).patch(`/work-hub/channels/${channels[1].id}/messages/${other.id}`).set("Cookie", author.cookie).send({ ...edits[winner], context: otherContext })).status).toBe(403);
    expect((await request(app).patch(path).set("Cookie", coworker.cookie).send(command("Not my message", 2))).status).toBe(403);
    expect((await request(app).patch(path).set("Cookie", foreign.cookie).send(command("Foreign", 2))).status).toBe(404);
    const deletion = { ...command("", 2), payload: {} };
    const deleted = await request(app).delete(path).set("Cookie", author.cookie).send(deletion);
    expect(deleted.status).toBe(200);
    expect(deleted.body.resource).toMatchObject({ body: "", version: 3 });
    expect(deleted.body.resource.deletedAt).toBeTruthy();
    const deletedReplay = await request(app).delete(path).set("Cookie", author.cookie).send(deletion);
    expect(deletedReplay.status).toBe(200);
    expect(deletedReplay.body.resource).toEqual(deleted.body.resource);
    expect((await request(app).delete(`/work-hub/channels/${channels[1].id}/messages/${other.id}`).set("Cookie", author.cookie).send({ ...deletion, context: otherContext })).status).toBe(403);
    // A historical edit receipt remains historical; replay never resurrects a tombstone.
    expect((await request(app).patch(path).set("Cookie", author.cookie).send(edits[winner])).status).toBe(200);
    expect((await d.db.select().from(d.workHubMessagesTable).where(eq(d.workHubMessagesTable.id, message.id)))[0]).toMatchObject({ body: "", version: 3 });
    await d.db.update(d.userOrgMembershipsTable).set({ role: "field_employee" }).where(eq(d.userOrgMembershipsTable.id, author.membership.id));
    expect((await request(app).delete(path).set("Cookie", author.cookie).send(deletion)).status).toBe(403);
    const operations = await d.db.select().from(d.workHubClientOperationsTable).where(eq(d.workHubClientOperationsTable.userId, author.user.id));
    expect(operations).toHaveLength(2);
  });
});
