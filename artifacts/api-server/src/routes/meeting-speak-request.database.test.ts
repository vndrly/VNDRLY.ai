import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
describe.runIf(
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
    process.env.VNDRLY_ISOLATED_TEST_DB === "1",
)("canonical immutable speak requests", () => {
  it("serializes exact retries, preserves request time, denies foreign targets and current revoked participation", async () => {
    const { assertFreshLocalTestDatabaseEnvironment } =
      await import("../../../../scripts/fresh-test-database.mjs");
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const d = await import("@workspace/db"),
      identity = await d.pool.query(
        "select current_database() as name,host(inet_server_addr()) as address,inet_server_port() as port",
      ),
      url = new URL(process.env.DATABASE_URL!);
    expect(identity.rows[0].name).toBe(
      decodeURIComponent(url.pathname.slice(1)),
    );
    expect(["127.0.0.1", "::1"]).toContain(identity.rows[0].address);
    expect(identity.rows[0].port).toBe(Number(url.port || 5432));
    const { eq, and } = await import("drizzle-orm"),
      express = (await import("express")).default,
      cookieParser = (await import("cookie-parser")).default,
      request = (await import("supertest")).default,
      router = (await import("./workHubMeetings")).default,
      { resolveContext } = await import("./auth"),
      { buildTestCookie } = await import("../test-utils/session");
    const tag = randomUUID(),
      companies = [];
    for (const name of ["own", "foreign"]) {
      const [row] = await d.db
        .insert(d.vendorsTable)
        .values({
          name: "Synthetic meeting message " + name + tag,
          contactName: "Synthetic",
          contactEmail: name + tag + "@example.invalid",
        })
        .returning();
      companies.push(row);
    }
    const actors = [];
    for (const [index, vendor] of [
      companies[0],
      companies[0],
      companies[0],
      companies[1],
    ].entries()) {
      const [user] = await d.db
        .insert(d.usersTable)
        .values({
          username: "synthetic-room-message-" + index + tag,
          passwordHash: "unusable-test-hash",
          displayName: "Synthetic meeting message actor",
          role: "vendor",
        })
        .returning();
      const [membership] = await d.db
        .insert(d.userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "member",
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
    const [host, cohost, ordinary, foreign] = actors;
    const [meeting] = await d.db
      .insert(d.workHubMeetingsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: companies[0].id,
        title: "Synthetic V invitation",
        timezone: "UTC",
        createdById: host.user.id,
      })
      .returning();
    const [occurrence, other] = await d.db
      .insert(d.workHubMeetingOccurrencesTable)
      .values(
        [0, 1].map((i) => ({
          meetingId: meeting.id,
          startsAt: new Date(Date.now() + i * 3600000),
          status: "scheduled",
          runtime: { sequence: 8, presence: {} },
          transcriptState: "off",
        })),
      )
      .returning();
    await d.db.insert(d.workHubMeetingParticipantsTable).values([
      { occurrenceId: occurrence.id, userId: host.user.id, role: "host" },
      { occurrenceId: occurrence.id, userId: cohost.user.id, role: "co_host" },
      {
        occurrenceId: occurrence.id,
        userId: ordinary.user.id,
        role: "participant",
      },
      { occurrenceId: other.id, userId: host.user.id, role: "host" },
    ]);
    const app = express()
      .use(express.json())
      .use(cookieParser())
      .use("/meetings", router);

    const { workHubMeetingParticipationAuthorizationsTable } =
      await import("@workspace/db/schema");
    await d.db.insert(workHubMeetingParticipationAuthorizationsTable).values(
      [host, cohost, ordinary].map((a) => ({
        userId: a.user.id,
        policyVersion: meeting.policyVersion,
        source: "synthetic-isolated-test",
        acceptedAt: new Date(),
      })),
    );

    const now = Date.now();
    await d.db
      .update(d.workHubMeetingParticipantsTable)
      .set({
        hostMutedAt: new Date(now),
        hostMutedById: host.user.id,
        hostMuteGeneration: 1,
      })
      .where(
        and(
          eq(d.workHubMeetingParticipantsTable.occurrenceId, occurrence.id),
          eq(d.workHubMeetingParticipantsTable.userId, ordinary.user.id),
        ),
      );
    await d.db
      .update(d.workHubMeetingOccurrencesTable)
      .set({
        runtime: {
          presence: {
            [host.user.id]: { seenAt: now, joinedAt: now, speaking: false },
            [ordinary.user.id]: { seenAt: now, joinedAt: now, speaking: false },
          },
        },
      })
      .where(eq(d.workHubMeetingOccurrencesTable.id, occurrence.id));
    await d.db
      .insert(d.workHubMeetingParticipantsTable)
      .values({
        occurrenceId: other.id,
        userId: ordinary.user.id,
        role: "participant",
        hostMutedAt: new Date(now),
        hostMutedById: host.user.id,
      });
    const path = "/meetings/" + occurrence.id + "/request-to-speak",
      operationId = randomUUID();
    const replies = await Promise.all(
      [0, 1, 2].map(() =>
        request(app)
          .post(path)
          .set("Cookie", ordinary.cookie)
          .send({ operationId }),
      ),
    );
    for (const reply of replies) {
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toEqual(replies[0].body);
    }
    const receipt = replies[0].body;
    expect((await request(app).post(path).set("Cookie", host.cookie).send({ operationId: randomUUID() })).status).toBe(409);
    expect((await request(app).get(path + "/operations/" + operationId).set("Cookie", host.cookie)).body).toEqual({ receipt: null });
    expect(receipt).toMatchObject({
      occurrenceId: occurrence.id,
      operationId,
      actorUserId: ordinary.user.id,
      microphoneOpened: false,
      consentAccepted: false,
    });
    const read = await request(app)
      .get(path + "/operations/" + operationId)
      .set("Cookie", ordinary.cookie);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ receipt });
    const saved = await d.pool.query(
      "select count(*)::int as count from work_hub_meeting_speak_requests where occurrence_id=$1 and user_id=$2",
      [occurrence.id, ordinary.user.id],
    );
    expect(saved.rows[0].count).toBe(1);
    const operations = await d.pool.query(
      "select count(*)::int as count from work_hub_client_operations where user_id=$1 and command_kind='meeting.speak' and operation_id=$2",
      [ordinary.user.id, operationId],
    );
    expect(operations.rows[0].count).toBe(1);
    const auditRows = await d.pool.query(
      "select count(*)::int as count from work_hub_audit_log where actor_user_id=$1 and subject_id=$2 and action='meeting.speak_requested'",
      [ordinary.user.id, occurrence.id],
    );
    expect(auditRows.rows[0].count).toBe(1);
    const pendingAgain = await request(app)
      .post(path)
      .set("Cookie", ordinary.cookie)
      .send({ operationId: randomUUID() });
    expect(pendingAgain.status).toBe(200);
    expect(pendingAgain.body.requestId).toBe(receipt.requestId);
    expect(pendingAgain.body.requestedAt).toBe(receipt.requestedAt);
    expect(
      (
        await d.pool.query(
          "select count(*)::int as count from work_hub_audit_log where actor_user_id=$1 and subject_id=$2 and action='meeting.speak_requested'",
          [ordinary.user.id, occurrence.id],
        )
      ).rows[0].count,
    ).toBe(1);
    const conflict = await request(app)
      .post("/meetings/" + other.id + "/request-to-speak")
      .set("Cookie", ordinary.cookie)
      .send({ operationId });
    expect(conflict.status).toBe(409);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", foreign.cookie)
          .send({ operationId: randomUUID() })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", ordinary.cookie)
          .send({ operationId, targetUserId: host.user.id })
      ).status,
    ).toBe(400);
    // Host releasing a mute cannot erase the original outcome or remotely reopen the microphone.
    await d.db
      .update(d.workHubMeetingParticipantsTable)
      .set({ hostMutedAt: null, hostMutedById: null })
      .where(
        and(
          eq(d.workHubMeetingParticipantsTable.occurrenceId, occurrence.id),
          eq(d.workHubMeetingParticipantsTable.userId, ordinary.user.id),
        ),
      );
    expect(
      (
        await request(app)
          .get(path + "/operations/" + operationId)
          .set("Cookie", ordinary.cookie)
      ).body,
    ).toEqual({ receipt });
    await d.db
      .update(workHubMeetingParticipationAuthorizationsTable)
      .set({ revokedAt: new Date() })
      .where(
        eq(
          workHubMeetingParticipationAuthorizationsTable.userId,
          ordinary.user.id,
        ),
      );
    expect(
      (
        await request(app)
          .get(path + "/operations/" + operationId)
          .set("Cookie", ordinary.cookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", ordinary.cookie)
          .send({ operationId })
      ).status,
    ).toBe(403);
    await d.db
      .update(d.usersTable)
      .set({ sessionVersion: ordinary.user.sessionVersion + 1 })
      .where(eq(d.usersTable.id, ordinary.user.id));
    expect(
      (
        await request(app)
          .get(path + "/operations/" + operationId)
          .set("Cookie", ordinary.cookie)
      ).status,
    ).toBe(403);
  });
});
