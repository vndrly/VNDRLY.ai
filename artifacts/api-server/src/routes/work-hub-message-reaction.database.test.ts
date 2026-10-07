import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1")("message reaction desired state and exact retry", () => {
  it("serializes desired state and legacy toggles, binds replay and denies revoked/foreign actors", async () => {
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
    const reactionPath = path + "/reactions";
    const command = (action?: string, operationId = randomUUID(), emoji = "👍") => ({ operationId, payloadVersion: 1, expectedVersion: 1, owner: { type: "vendor", id: vendor.id }, context: { kind: "organization", id: vendor.id }, payload: { emoji, ...(action ? { action } : {}) } });
    const adds = [command("add"), command("add")];
    const responses = await Promise.all(adds.map(body => request(app).post(reactionPath).set("Cookie", author.cookie).send(body)));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    for (const response of responses) expect(response.body.resource).toMatchObject({ actorUserId: author.user.id, messageId: message.id, channelId: channels[0].id, emoji: "👍", action: "add", active: true, expectedVersion: 1 });
    expect(await d.db.select().from(d.workHubReactionsTable).where(eq(d.workHubReactionsTable.messageId, message.id))).toHaveLength(1);
    const replay = await request(app).post(reactionPath).set("Cookie", author.cookie).send(adds[0]);
    expect(replay.status).toBe(200);
    expect(replay.body.resource).toEqual(responses[0].body.resource);
    expect((await request(app).post(reactionPath).set("Cookie", author.cookie).send({ ...adds[0], payload: { emoji: "👍", action: "remove" } })).status).toBe(403);
    expect((await request(app).post(reactionPath).set("Cookie", author.cookie).send({ ...adds[0], payload: { emoji: "✅", action: "add" } })).status).toBe(403);
    expect((await request(app).post(`/work-hub/channels/${channels[1].id}/messages/${other.id}/reactions`).set("Cookie", author.cookie).send({ ...adds[0], context: { kind: "chat", id: channels[1].contextId } })).status).toBe(403);
    expect((await request(app).post(reactionPath).set("Cookie", foreign.cookie).send(command("add"))).status).toBe(404);
    expect((await request(app).post(reactionPath).set("Cookie", coworker.cookie).send(command("add"))).status).toBe(200);
    const removes = [command("remove"), command("remove")];
    expect((await Promise.all(removes.map(body => request(app).post(reactionPath).set("Cookie", author.cookie).send(body)))).map(r => r.status)).toEqual([200, 200]);
    const { and } = await import("drizzle-orm");
    const own = () => d.db.select().from(d.workHubReactionsTable).where(and(eq(d.workHubReactionsTable.messageId, message.id), eq(d.workHubReactionsTable.userId, author.user.id)));
    expect(await own()).toHaveLength(0);
    const toggles = [command(), command()];
    const toggled = await Promise.all(toggles.map(body => request(app).post(reactionPath).set("Cookie", author.cookie).send(body)));
    expect(toggled.map(r => r.status)).toEqual([200, 200]);
    expect(toggled.map(r => r.body.resource.active).sort()).toEqual([false, true]);
    expect(await own()).toHaveLength(0);
    await d.db.update(d.userOrgMembershipsTable).set({ role: "field_employee" }).where(eq(d.userOrgMembershipsTable.id, author.membership.id));
    expect((await request(app).post(reactionPath).set("Cookie", author.cookie).send(adds[0])).status).toBe(403);
    expect(await own()).toHaveLength(0);
  });
});
