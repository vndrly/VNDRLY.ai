import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
// Only the feature switch is enabled for this fixture; all session/member/channel authorization is real.
vi.mock("../work-hub/feature-access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWorkHubEnabled: async () => true,
}));
describe.skipIf(!isolated)(
  "away responder canonical isolated persistence",
  () => {
    it("saves one actual reply under concurrent incoming messages, preserves private setting on prefs PUT, and denies revoked replay", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const s = await import("@workspace/db");
      const target = new URL(process.env.DATABASE_URL!);
      const identity = (
        await s.pool.query(
          "SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port",
        )
      ).rows[0];
      expect(identity).toEqual({
        database: process.env.VNDRLY_FRESH_TEST_DB_NAME,
        address: "127.0.0.1",
        port: Number(target.port),
      });
      const { eq, and } = await import("drizzle-orm");
      const { default: express } = await import("express");
      const { default: cookieParser } = await import("cookie-parser");
      const { default: request } = await import("supertest");
      const { buildTestCookie } = await import("../test-utils/session");
      const { default: collaboration } =
        await import("../routes/workHubCollaboration");
      const { default: channels } = await import("../routes/workHubChannels");
      const { attachTestErrorMiddleware } =
        await import("../test-utils/route-app");
      const marker = randomUUID();
      const [vendor] = await s.db
        .insert(s.vendorsTable)
        .values({
          name: `Synthetic away ${marker}`,
          contactName: "Synthetic",
          contactEmail: `${marker}@example.invalid`,
        })
        .returning();
      const users = await s.db
        .insert(s.usersTable)
        .values(
          ["away", "sender"].map((name) => ({
            username: `away-${name}-${marker}`,
            passwordHash: "synthetic-unusable-login",
            displayName: `Synthetic ${name}`,
            role: "vendor" as const,
          })),
        )
        .returning();
      const memberships = await s.db
        .insert(s.userOrgMembershipsTable)
        .values(
          users.map((user) => ({
            userId: user.id,
            orgType: "vendor" as const,
            vendorId: vendor.id,
            role: "admin" as const,
          })),
        )
        .returning();
      const [channel] = await s.db
        .insert(s.workHubChannelsTable)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: vendor.id,
          contextKind: "chat",
          contextId: marker,
          name: "Synthetic isolated away conversation",
          visibility: "private",
          createdById: users[0].id,
        })
        .returning();
      await s.db.insert(s.workHubChannelMembersTable).values(
        users.map((user) => ({
          channelId: channel.id,
          userId: user.id,
          mode: "member",
        })),
      );
      const cookies = users.map((user) =>
        buildTestCookie(
          {
            userId: user.id,
            role: "vendor",
            vendorId: vendor.id,
            activeMembershipId: memberships.find(
              (member) => member.userId === user.id,
            )!.id,
            membershipRole: "admin",
            sv: user.sessionVersion,
          },
          { secret: process.env.SESSION_SECRET! },
        ),
      );
      const app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", collaboration);
      app.use("/api", channels);
      attachTestErrorMiddleware(app);
      const base = "/api/work-hub/away-responder";
      const choices = await request(app)
        .get(`${base}/channels`)
        .set("Cookie", cookies[0]);
      expect(choices.status).toBe(200);
      expect(choices.body.channels).toEqual([
        { id: channel.id, name: channel.name },
      ]);
      const command = {
        operationId: randomUUID(),
        action: "configure",
        expectedVersion: 0,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        replyText: "I am away. I will review your message when I return.",
        channelIds: [channel.id],
      };
      const configured = await request(app)
        .post(base)
        .set("Cookie", cookies[0])
        .send(command);
      expect(configured.status).toBe(200);
      expect(configured.body).toMatchObject({
        operationId: command.operationId,
        status: "configured",
        providerDeliveryVerified: false,
        rule: { version: 1 },
      });
      const send = () =>
        request(app)
          .post(`/api/work-hub/channels/${channel.id}/messages`)
          .set("Cookie", cookies[1])
          .send({
            operationId: randomUUID(),
            owner: { type: "vendor", id: vendor.id },
            context: { kind: "chat", id: channel.id },
            expectedVersion: null,
            payloadVersion: 1,
            payload: { kind: "text", body: "Synthetic incoming message" },
          });
      const incoming = await Promise.all([send(), send()]);
      expect(incoming.map((response) => response.status)).toEqual([201, 201]);
      const replies = await s.db
        .select()
        .from(s.workHubMessagesTable)
        .where(
          and(
            eq(s.workHubMessagesTable.channelId, channel.id),
            eq(s.workHubMessagesTable.authorUserId, users[0].id),
          ),
        );
      expect(replies).toHaveLength(1);
      expect(replies[0].body).toBe(command.replyText);
      expect(replies[0].parentMessageId).not.toBeNull();
      const operations = await s.db
        .select()
        .from(s.workHubClientOperationsTable)
        .where(
          and(
            eq(s.workHubClientOperationsTable.userId, users[0].id),
            eq(s.workHubClientOperationsTable.commandKind, "away.reply"),
          ),
        );
      expect(operations).toHaveLength(1);
      const audit = await s.db
        .select()
        .from(s.workHubAuditLogTable)
        .where(
          eq(s.workHubAuditLogTable.operationId, replies[0].clientOperationId),
        );
      expect(audit).toHaveLength(1);
      const prefs = await request(app)
        .put("/api/work-hub/preferences")
        .set("Cookie", cookies[0])
        .send({
          pinned: [channel.id],
          awayResponder: { rule: { status: "revoked" } },
        });
      expect(prefs.status).toBe(200);
      const read = await request(app).get(base).set("Cookie", cookies[0]);
      expect(read.body).toMatchObject({
        version: 1,
        rule: { status: "active", replyText: command.replyText },
      });
      expect(JSON.stringify(read.body)).not.toContain("approvedSession");
      const readback = await request(app)
        .get(`${base}/operations/${command.operationId}`)
        .set("Cookie", cookies[0]);
      expect(readback.body.receipt).toEqual(configured.body);
      const retry = await request(app)
        .post(base)
        .set("Cookie", cookies[0])
        .send(command);
      expect(retry.body).toEqual(configured.body);
      // A new window has no prior reply receipt: revocation, rather than dedupe,
      // must prevent the next incoming message from creating an automatic reply.
      const nextWindow = {
        ...command,
        operationId: randomUUID(),
        expectedVersion: 1,
        endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      };
      expect(
        (
          await request(app)
            .post(base)
            .set("Cookie", cookies[0])
            .send(nextWindow)
        ).status,
      ).toBe(200);
      await s.db
        .update(s.usersTable)
        .set({ sessionVersion: users[0].sessionVersion + 1 })
        .where(eq(s.usersTable.id, users[0].id));
      expect(
        (await request(app).post(base).set("Cookie", cookies[0]).send(command))
          .status,
      ).toBe(403);
      expect((await send()).status).toBe(201);
      expect(
        await s.db
          .select()
          .from(s.workHubMessagesTable)
          .where(
            and(
              eq(s.workHubMessagesTable.channelId, channel.id),
              eq(s.workHubMessagesTable.authorUserId, users[0].id),
            ),
          ),
      ).toHaveLength(1);
    });
  },
);
