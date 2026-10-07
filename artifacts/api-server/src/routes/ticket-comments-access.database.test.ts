import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
const notices = vi.hoisted(() => vi.fn());
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../lib/sendgrid", () => ({
  sendNotificationAlertEmail: vi.fn(),
  sendNotificationDigestEmail: vi.fn(),
  buildNotificationDeepLink: (x: unknown) => x,
}));
// Keep real recipient lookup; observe the exact filtered notification destinations.
vi.mock("./notifications", async (original) => ({
  ...(await original<typeof import("./notifications")>()),
  notifyUsers: notices,
}));
describe.runIf(
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
    process.env.VNDRLY_ISOLATED_TEST_DB === "1",
)("ticket discussion canonical authority", () => {
  it("keeps primary/foreman/acting/crew access while denying broadcast-only and foreign workers across discussion endpoints", async () => {
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
    const express = (await import("express")).default,
      cookieParser = (await import("cookie-parser")).default,
      request = (await import("supertest")).default;
    const router = (await import("./comments")).default,
      { buildTestCookie } = await import("../test-utils/session"),
      { resolveContext } = await import("./auth");
    const tag = randomUUID();
    const [vendor] = await d.db
      .insert(d.vendorsTable)
      .values({
        name: "Synthetic discussion " + tag,
        contactName: "Synthetic",
        contactEmail: tag + "@example.invalid",
      })
      .returning();
    const [partner] = await d.db
      .insert(d.partnersTable)
      .values({
        name: "Synthetic discussion owner " + tag,
        contactName: "Synthetic",
        contactEmail: tag + "@example.invalid",
      })
      .returning();
    const people = [];
    for (const kind of ["primary", "foreman", "acting", "crew", "unassigned"]) {
      const [user] = await d.db
        .insert(d.usersTable)
        .values({
          username: kind + tag,
          passwordHash: "unusable-test-hash",
          role: "vendor",
          displayName: "Synthetic " + kind,
        })
        .returning();
      const [person] = await d.db
        .insert(d.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: user.id,
          vendorRole: kind === "foreman" ? "foreman" : "gate_supervisor",
          firstName: "Synthetic",
          lastName: kind,
          email: kind + tag + "@example.invalid",
        })
        .returning();
      await d.db.insert(d.userOrgMembershipsTable).values({
        userId: user.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "field_employee",
        vendorPeopleId: person.id,
      });
      people.push({
        kind,
        user,
        person,
        cookie: buildTestCookie({
          ...(await resolveContext(user)),
          userId: user.id,
          sv: user.sessionVersion,
        }),
      });
    }
    const [site] = await d.db
      .insert(d.siteLocationsTable)
      .values({
        partnerId: partner.id,
        name: "Synthetic discussion site",
        address: "Synthetic",
        latitude: 0,
        longitude: 0,
        siteCode: "DISC-" + tag,
      })
      .returning();
    const [work] = await d.db
      .insert(d.workTypesTable)
      .values({ name: "Synthetic discussion " + tag, category: "test" })
      .returning();
    const [ticket] = await d.db
      .insert(d.ticketsTable)
      .values({
        vendorId: vendor.id,
        siteLocationId: site.id,
        workTypeId: work.id,
        status: "initiated",
        lifecycleState: "pending_arrival",
        fieldEmployeeId: people[0].person.id,
        foremanUserId: people[1].user.id,
        actingForemanUserId: people[2].user.id,
      })
      .returning();
    await d.db
      .insert(d.ticketCrewTable)
      .values({ ticketId: ticket.id, employeeId: people[3].person.id });
    const [foreignVendor] = await d.db
      .insert(d.vendorsTable)
      .values({
        name: "Synthetic foreign discussion " + tag,
        contactName: "Synthetic",
        contactEmail: "foreign" + tag + "@example.invalid",
      })
      .returning();
    const [foreignTicket] = await d.db
      .insert(d.ticketsTable)
      .values({
        vendorId: foreignVendor.id,
        siteLocationId: site.id,
        workTypeId: work.id,
        status: "initiated",
        lifecycleState: "pending_arrival",
      })
      .returning();
    const app = express().use(express.json()).use(cookieParser()).use(router);
    let commentId: number | undefined;
    for (const actor of people.slice(0, 4)) {
      const posted = await request(app)
        .post(`/tickets/${ticket.id}/comments`)
        .set("Cookie", actor.cookie)
        .send({ content: "Synthetic no-work discussion " + actor.kind });
      expect(posted.status).toBe(201);
      commentId = posted.body.id;
      expect(
        (
          await request(app)
            .get(`/tickets/${ticket.id}/comments`)
            .set("Cookie", actor.cookie)
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await request(app)
          .get(`/tickets/${foreignTicket.id}/comments`)
          .set("Cookie", people[0].cookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/tickets/${foreignTicket.id}/comments`)
          .set("Cookie", people[0].cookie)
          .send({ content: "Denied foreign" })
      ).status,
    ).toBe(403);
    const denied = people[4];
    for (const path of [
      `/tickets/${ticket.id}/comments`,
      `/tickets/${ticket.id}/comments-participants`,
      `/tickets/${ticket.id}/comments/${commentId}/seen-by`,
    ])
      expect(
        (await request(app).get(path).set("Cookie", denied.cookie)).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/tickets/${ticket.id}/comments`)
          .set("Cookie", denied.cookie)
          .send({ content: "Denied" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/tickets/${ticket.id}/comments/${commentId}`)
          .set("Cookie", denied.cookie)
          .send({ content: "Denied" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/tickets/${ticket.id}/comments/${commentId}`)
          .set("Cookie", denied.cookie)
      ).status,
    ).toBe(403);
    const picker = await request(app)
      .get(`/tickets/${ticket.id}/comments-participants`)
      .set("Cookie", people[0].cookie);
    expect(picker.body.map((x: { id: number }) => x.id)).not.toContain(
      denied.user.id,
    );
    expect(notices.mock.calls.flatMap((x) => x[0])).not.toContain(
      denied.user.id,
    );
  });
});
