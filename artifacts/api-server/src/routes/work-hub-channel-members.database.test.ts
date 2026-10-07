import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
describe.runIf(
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
    process.env.VNDRLY_ISOLATED_TEST_DB === "1",
)("current existing-channel member authority", () => {
  it("preserves owners, serializes additions once, and denies changed roles and foreign shared invitations", async () => {
    const { assertFreshLocalTestDatabaseEnvironment } =
      await import("../../../../scripts/fresh-test-database.mjs");
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const d = await import("@workspace/db");
    const identity = await d.pool.query(
      "select current_database() as name,host(inet_server_addr()) as address,inet_server_port() as port",
    );
    const configured = new URL(process.env.DATABASE_URL!);
    expect(identity.rows[0].name).toBe(
      decodeURIComponent(configured.pathname.slice(1)),
    );
    expect(["127.0.0.1", "::1"]).toContain(identity.rows[0].address);
    expect(identity.rows[0].port).toBe(Number(configured.port || 5432));
    const { and, eq } = await import("drizzle-orm");
    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const request = (await import("supertest")).default;
    const router = (await import("./workHubChannels")).default;
    const { resolveContext } = await import("./auth");
    const { buildTestCookie } = await import("../test-utils/session");
    const tag = randomUUID();
    const [vendor] = await d.db
      .insert(d.vendorsTable)
      .values({
        name: "Synthetic members " + tag,
        contactName: "Synthetic",
        contactEmail: tag + "@example.invalid",
      })
      .returning();
    const [foreignVendor] = await d.db
      .insert(d.vendorsTable)
      .values({
        name: "Synthetic foreign members " + tag,
        contactName: "Synthetic",
        contactEmail: "foreign-" + tag + "@example.invalid",
      })
      .returning();
    const actors = [];
    for (const [index, company] of [vendor, vendor, foreignVendor].entries()) {
      const [user] = await d.db
        .insert(d.usersTable)
        .values({
          username: `synthetic-member-${index}-${tag}`,
          email: `member-${index}-${tag}@example.invalid`,
          passwordHash: "unusable-test-hash",
          displayName: "Synthetic member",
          role: "vendor",
        })
        .returning();
      const [membership] = await d.db
        .insert(d.userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "vendor",
          vendorId: company.id,
          role: index === 0 ? "admin" : "member",
        })
        .returning();
      actors.push({
        user,
        membership,
        cookie: buildTestCookie({
          ...(await resolveContext(user)),
          userId: user.id,
          sv: user.sessionVersion,
        }),
      });
    }
    const [owner, colleague, foreign] = actors;
    const [channel] = await d.db
      .insert(d.workHubChannelsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendor.id,
        contextKind: "chat",
        contextId: randomUUID(),
        name: "Synthetic shared members",
        visibility: "private",
        createdById: owner.user.id,
      })
      .returning();
    await d.db
      .insert(d.workHubCollaborationChannelsTable)
      .values({ channelId: channel.id, kind: "shared" });
    const [ownerRow] = await d.db
      .insert(d.workHubChannelMembersTable)
      .values({ channelId: channel.id, userId: owner.user.id, mode: "owner" })
      .returning();
    const app = express().use(express.json()).use(cookieParser()).use(router);
    const path = `/work-hub/channels/${channel.id}`;
    const add = (email: string) =>
      request(app)
        .post(path + "/members")
        .set("Cookie", owner.cookie)
        .send({ email });
    expect(
      (
        await request(app)
          .get(path + "/member-access")
          .set("Cookie", owner.cookie)
      ).body,
    ).toEqual({ canManage: true });
    expect((await add(owner.user.email!)).body.mode).toBe("owner");
    expect(
      (
        await d.db
          .select()
          .from(d.workHubChannelMembersTable)
          .where(eq(d.workHubChannelMembersTable.id, ownerRow.id))
      )[0].mode,
    ).toBe("owner");
    const results = await Promise.all([
      add(colleague.user.email!),
      add(colleague.user.email!),
      add(colleague.user.email!),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    expect(results[1].body).toEqual(results[0].body);
    expect(results[2].body).toEqual(results[0].body);
    expect(
      await d.db
        .select()
        .from(d.workHubChannelMembersTable)
        .where(
          and(
            eq(d.workHubChannelMembersTable.channelId, channel.id),
            eq(d.workHubChannelMembersTable.userId, colleague.user.id),
          ),
        ),
    ).toHaveLength(1);
    const audit = () =>
      d.db
        .select()
        .from(d.workHubAuditLogTable)
        .where(
          and(
            eq(d.workHubAuditLogTable.subjectId, channel.id),
            eq(d.workHubAuditLogTable.action, "channel.member_added"),
          ),
        );
    expect(await audit()).toHaveLength(1);
    const list = await request(app)
      .get(path + "/members")
      .set("Cookie", colleague.cookie);
    expect(list.status).toBe(200);
    expect(
      list.body.map((row: { userId: number }) => row.userId).sort(),
    ).toEqual([owner.user.id, colleague.user.id].sort());
    expect(
      (
        await request(app)
          .get(path + "/member-access")
          .set("Cookie", colleague.cookie)
      ).body,
    ).toEqual({ canManage: false });
    expect((await add(foreign.user.email!)).status).toBe(403);
    expect(
      (
        await request(app)
          .get(path + "/members")
          .set("Cookie", foreign.cookie)
      ).status,
    ).toBe(404);
    await d.db
      .update(d.workHubCollaborationChannelsTable)
      .set({ kind: "chat" })
      .where(eq(d.workHubCollaborationChannelsTable.channelId, channel.id));
    expect(
      (
        await request(app)
          .get(path + "/member-access")
          .set("Cookie", owner.cookie)
      ).body,
    ).toEqual({ canManage: false });
    expect((await add(colleague.user.email!)).status).toBe(403);
    await d.db
      .update(d.userOrgMembershipsTable)
      .set({ role: "member" })
      .where(eq(d.userOrgMembershipsTable.id, owner.membership.id));
    expect((await add(colleague.user.email!)).status).toBe(403);
    expect(
      (
        await request(app)
          .get(path + "/members")
          .set("Cookie", owner.cookie)
      ).status,
    ).toBe(403);
    expect(await audit()).toHaveLength(1);
  }, 30_000);
});
