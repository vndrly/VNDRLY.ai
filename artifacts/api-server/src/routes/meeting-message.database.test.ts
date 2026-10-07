import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
describe.runIf(
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
    process.env.VNDRLY_ISOLATED_TEST_DB === "1",
)("canonical prepared meeting messages", () => {
  it("persists exact public/private messages once and refuses changed targets, revoked participants and unknown authority", async () => {
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
    await d.db
      .insert(workHubMeetingParticipationAuthorizationsTable)
      .values(
        [host, cohost].map((a) => ({
          userId: a.user.id,
          policyVersion: meeting.policyVersion,
          source: "synthetic-isolated-test",
          acceptedAt: new Date(),
        })),
      );
    const path = "/meetings/" + occurrence.id + "/chat",
      body = {
        id: randomUUID(),
        body: "SYNTHETIC approved private room message",
        recipientUserId: cohost.user.id,
      };
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", ordinary.cookie)
          .send({ ...body, id: randomUUID() })
      ).status,
    ).toBe(403);
    expect([403, 404]).toContain(
      (
        await request(app)
          .post(path)
          .set("Cookie", foreign.cookie)
          .send({ ...body, id: randomUUID() })
      ).status,
    );
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", host.cookie)
          .send({ ...body, recipientUserId: foreign.user.id })
      ).status,
    ).toBe(404);
    const replies = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post(path).set("Cookie", host.cookie).send(body),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    for (const r of replies) expect(r.body).toEqual(replies[0].body);
    expect(
      await d.db
        .select()
        .from(d.workHubMeetingChatTable)
        .where(eq(d.workHubMeetingChatTable.id, body.id)),
    ).toHaveLength(1);
    const readback = path + "/operations/" + body.id;
    const saved = await request(app).get(readback).set("Cookie", host.cookie);
    expect(saved.status).toBe(200);
    expect(saved.body.receipt).toMatchObject({
      id: body.id,
      occurrenceId: occurrence.id,
      userId: host.user.id,
      body: body.body,
      recipientUserId: cohost.user.id,
      status: "saved",
      consentAccepted: false,
      deviceCaptureStarted: false,
    });
    expect(
      (await request(app).get(readback).set("Cookie", cohost.cookie)).body,
    ).toEqual({ receipt: null });
    for (const changed of [
      { ...body, body: "different" },
      { ...body, recipientUserId: null },
    ])
      expect(
        (await request(app).post(path).set("Cookie", host.cookie).send(changed))
          .status,
      ).toBe(409);
    expect(
      (
        await request(app)
          .post("/meetings/" + other.id + "/chat")
          .set("Cookie", host.cookie)
          .send({ ...body, recipientUserId: null })
      ).status,
    ).toBe(409);
    const publicBody = {
      id: randomUUID(),
      body: "SYNTHETIC shared room message",
    };
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", cohost.cookie)
          .send(publicBody)
      ).status,
    ).toBe(200);
    await d.db
      .update(d.workHubMeetingParticipantsTable)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(d.workHubMeetingParticipantsTable.occurrenceId, occurrence.id),
          eq(d.workHubMeetingParticipantsTable.userId, cohost.user.id),
        ),
      );
    expect(
      (await request(app).get(readback).set("Cookie", host.cookie)).status,
    ).toBe(403);
    expect(
      (await request(app).post(path).set("Cookie", host.cookie).send(body))
        .status,
    ).toBe(404);
    await d.db
      .update(d.usersTable)
      .set({ sessionVersion: host.user.sessionVersion + 1 })
      .where(eq(d.usersTable.id, host.user.id));
    expect(
      (await request(app).get(readback).set("Cookie", host.cookie)).status,
    ).toBe(403);
    expect(
      (await request(app).post(path).set("Cookie", host.cookie).send(body))
        .status,
    ).toBe(403);
    expect(
      await d.db
        .select()
        .from(d.workHubMeetingChatTable)
        .where(eq(d.workHubMeetingChatTable.occurrenceId, occurrence.id)),
    ).toHaveLength(2);
  }, 30000);
});
