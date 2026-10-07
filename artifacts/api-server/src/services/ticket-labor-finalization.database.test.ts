import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Actual database effects are restricted to the runner-created fresh loopback database.
describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1")("labor freeze durable transaction", () => {
  it("checks current assignment, freezes once under concurrency, preserves manual lines and rolls back failed regeneration", async () => {
    const { assertFreshLocalTestDatabaseEnvironment } = await import("../../../../scripts/fresh-test-database.mjs");
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const d = await import("@workspace/db"), { eq } = await import("drizzle-orm");
    const configured = new URL(process.env.DATABASE_URL!);
    const identity = await d.pool.query("SELECT current_database() AS name,host(inet_server_addr()) AS host,inet_server_port() AS port");
    expect(identity.rows[0].name).toBe(decodeURIComponent(configured.pathname.slice(1)));
    expect(["127.0.0.1", "::1"]).toContain(identity.rows[0].host);
    expect(identity.rows[0].port).toBe(Number(configured.port || 5432));
    const { createTicketLaborFinalizationService } = await import("./ticket-labor-finalization");
    const { regenerateAutoLaborLines } = await import("../lib/auto-labor-lines");
    const { resolveContext } = await import("../routes/auth");
    const tag = randomUUID();
    const [vendor] = await d.db.insert(d.vendorsTable).values({ name: "Synthetic labor " + tag, contactName: "Synthetic", contactEmail: tag + "@example.invalid" }).returning();
    const [partner] = await d.db.insert(d.partnersTable).values({ name: "Synthetic labor site owner " + tag, contactName: "Synthetic", contactEmail: tag + "@example.invalid" }).returning();
    const [site] = await d.db.insert(d.siteLocationsTable).values({ partnerId: partner.id, name: "Synthetic labor site", address: "Synthetic", latitude: 0, longitude: 0, siteCode: "LAB-" + tag }).returning();
    const [work] = await d.db.insert(d.workTypesTable).values({ name: "Synthetic labor " + tag, category: "test" }).returning();
    const actors: Array<{ user: typeof d.usersTable.$inferSelect; person: typeof d.vendorPeopleTable.$inferSelect; session: import("../lib/session").SessionPayload }> = [];
    for (const kind of ["foreman", "worker", "unassigned"]) {
      const [user] = await d.db.insert(d.usersTable).values({ username: kind + tag, passwordHash: "unusable-synthetic-test", role: "vendor", displayName: "Synthetic " + kind }).returning();
      const [person] = await d.db.insert(d.vendorPeopleTable).values({ userId: user.id, vendorId: vendor.id, vendorRole: kind === "worker" ? "field_employee" : "foreman", firstName: "Synthetic", lastName: kind, email: kind + tag + "@example.invalid", hourlyRate: "10" }).returning();
      await d.db.insert(d.userOrgMembershipsTable).values({ userId: user.id, orgType: "vendor", vendorId: vendor.id, role: "field_employee", vendorPeopleId: person.id });
      actors.push({ user, person, session: { ...(await resolveContext(user)), userId: user.id, sv: user.sessionVersion } });
    }
    const makeTicket = async () => (await d.db.insert(d.ticketsTable).values({ vendorId: vendor.id, siteLocationId: site.id, workTypeId: work.id, status: "pending_review", lifecycleState: "off_site", fieldEmployeeId: actors[1].person.id, foremanUserId: actors[0].user.id }).returning())[0];
    const ticket = await makeTicket();
    await d.db.insert(d.ticketCheckInsTable).values({ ticketId: ticket.id, employeeId: actors[1].person.id, checkInAt: new Date("2026-10-07T08:00:00Z"), checkOutAt: new Date("2026-10-07T09:00:00Z"), hourlyRateAtTime: "10", source: "synthetic_fixture" });
    const [manual] = await d.db.insert(d.ticketLineItemsTable).values({ ticketId: ticket.id, type: "labor", description: "Synthetic manual line preserved", quantity: "2", unitPrice: "3" }).returning();
    const service = createTicketLaborFinalizationService();
    expect(await service.canFinalize(actors[0].session, ticket.id)).toBe(true);
    expect(await service.canFinalize(actors[1].session, ticket.id)).toBe(false);
    expect(await service.canFinalize(actors[2].session, ticket.id)).toBe(false);
    const command = { operationId: randomUUID(), expectedUpdatedAt: ticket.updatedAt.toISOString() };
    await expect(service.apply(actors[1].session, ticket.id, command)).rejects.toMatchObject({ status: 403 });
    await expect(service.apply({ ...actors[0].session, vendorId: vendor.id + 999999 }, ticket.id, command)).rejects.toMatchObject({ status: 403 });
    const saved = await Promise.all([service.apply(actors[0].session, ticket.id, command), service.apply(actors[0].session, ticket.id, command)]);
    expect(saved[1]).toEqual(saved[0]); expect(saved[0].autoLaborLineCount).toBe(1);
    expect(await service.read(actors[0].session, ticket.id, command.operationId)).toEqual(saved[0]);
    const rows = await d.db.select().from(d.ticketLineItemsTable).where(eq(d.ticketLineItemsTable.ticketId, ticket.id));
    expect(rows).toHaveLength(2); expect(rows.find(row => row.id === manual.id)).toEqual(manual);
    expect(await regenerateAutoLaborLines(ticket.id)).toBe(0);
    await expect(service.apply(actors[0].session, ticket.id, { ...command, operationId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const audits = await d.pool.query("SELECT id FROM assistant_action_audit WHERE target_type='ticket-labor-finalization' AND target_id=$1", [command.operationId]);
    expect(audits.rows).toHaveLength(1);
    const rollbackTicket = await makeTicket();
    const failing = createTicketLaborFinalizationService(d.pool, undefined, async client => { await client.query("INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'labor','Synthetic rolled back',1,1)", [rollbackTicket.id]); throw Error("synthetic regeneration failure"); });
    await expect(failing.apply(actors[0].session, rollbackTicket.id, { operationId: randomUUID(), expectedUpdatedAt: rollbackTicket.updatedAt.toISOString() })).rejects.toThrow("synthetic regeneration failure");
    expect((await d.db.select().from(d.ticketLineItemsTable).where(eq(d.ticketLineItemsTable.ticketId, rollbackTicket.id)))).toHaveLength(0);
    expect((await d.db.select().from(d.ticketsTable).where(eq(d.ticketsTable.id, rollbackTicket.id)))[0].closedAt).toBeNull();
    await d.db.update(d.userOrgMembershipsTable).set({ role: "member" }).where(eq(d.userOrgMembershipsTable.id, actors[0].session.activeMembershipId!));
    await expect(service.read(actors[0].session, ticket.id, command.operationId)).rejects.toMatchObject({ status: 403 });
    await expect(service.apply(actors[0].session, ticket.id, command)).rejects.toMatchObject({ status: 403 });
  });
});
