import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
describe.runIf(
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
    process.env.VNDRLY_ISOLATED_TEST_DB === "1",
)("canonical host V invitation atomic receipt", () => {
  it("serializes exact retry/CAS, preserves consent/runtime and refuses nonhost/foreign/revoked replay", async () => {
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
          name: "Synthetic invitation " + name + tag,
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
          username: "synthetic-v-invite-" + index + tag,
          passwordHash: "unusable-test-hash",
          displayName: "Synthetic invitation actor",
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
    const path = "/meetings/" + occurrence.id + "/askv",
      body = { operationId: randomUUID(), expectedVersion: 0, invited: true };
    for (const actor of [cohost, ordinary])
      expect(
        (await request(app).post(path).set("Cookie", actor.cookie).send(body))
          .status,
      ).toBe(403);
    expect([403, 404]).toContain(
      (await request(app).post(path).set("Cookie", foreign.cookie).send(body))
        .status,
    );
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", host.cookie)
          .send({ invited: true })
      ).status,
    ).toBe(400);
    const saved = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post(path).set("Cookie", host.cookie).send(body),
      ),
    );
    expect(saved.map((r) => r.status)).toEqual([200, 200, 200]);
    for (const r of saved) expect(r.body).toEqual(saved[0].body);
    const notices = () =>
      d.db
        .select()
        .from(d.workHubMeetingChatTable)
        .where(
          and(
            eq(d.workHubMeetingChatTable.occurrenceId, occurrence.id),
            eq(d.workHubMeetingChatTable.messageType, "system"),
          ),
        );
    expect(await notices()).toHaveLength(1);
    const lookup =
      path +
      "/operations/" +
      body.operationId +
      "?expectedVersion=0&invited=true";
    expect(
      (await request(app).get(lookup).set("Cookie", host.cookie)).body.receipt,
    ).toEqual(saved[0].body);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", host.cookie)
          .send({ ...body, invited: false })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/meetings/" + other.id + "/askv")
          .set("Cookie", host.cookie)
          .send(body)
      ).status,
    ).toBe(409);
    const noop = await request(app)
      .post(path)
      .set("Cookie", host.cookie)
      .send({ operationId: randomUUID(), expectedVersion: 1, invited: true });
    expect(noop.status).toBe(200);
    expect(noop.body.changed).toBe(false);
    expect(await notices()).toHaveLength(1);
    const race = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(path)
          .set("Cookie", host.cookie)
          .send({
            operationId: randomUUID(),
            expectedVersion: 2,
            invited: false,
          }),
      ),
    );
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await notices()).toHaveLength(2);
    const [current] = await d.db
      .select()
      .from(d.workHubMeetingOccurrencesTable)
      .where(eq(d.workHubMeetingOccurrencesTable.id, occurrence.id));
    expect(current.runtime).toEqual({
      sequence: 8,
      presence: {},
      askvInvitationRevision: 3,
    });
    expect(current.askvInvitedAt).toBeNull();
    expect(
      await d.db
        .select()
        .from(d.workHubMeetingConsentsTable)
        .where(eq(d.workHubMeetingConsentsTable.occurrenceId, occurrence.id)),
    ).toHaveLength(0);
    await d.db
      .update(d.userOrgMembershipsTable)
      .set({ role: "field_employee" })
      .where(eq(d.userOrgMembershipsTable.id, host.membership.id));
    expect(
      (await request(app).get(lookup).set("Cookie", host.cookie)).status,
    ).toBe(403);
    expect(await notices()).toHaveLength(2);
  });
});
