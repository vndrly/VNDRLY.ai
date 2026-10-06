import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, vendorsTable, partnersTable, siteLocationsTable, workTypesTable, ticketsTable, vendorPeopleTable, usersTable } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { runOpsDataTool } from "./data-tools-ops";
import { runTool } from "../routes/assistant";

describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("assistant read authorization against isolated records", () => {
  it("preserves simultaneous approved onboarding field updates", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const suffix = randomUUID();
    const [vendor] = await db.insert(vendorsTable).values({ name: `onboarding-lock-${suffix}`, contactName: "Synthetic", contactEmail: `${suffix}@example.invalid` }).returning();
    const [user] = await db.insert(usersTable).values({ username: `onboarding-${suffix}`, passwordHash: "unused-isolated-fixture", displayName: "Synthetic admin", role: "vendor" }).returning();
    const session = { userId: user.id, role: "vendor", vendorId: vendor.id, membershipRole: "admin" };
    await runTool("start_onboarding", {}, session, "");
    const results = await Promise.all(["federalTaxId", "stateTaxId", "physicalAddress", "billingAddress"].map(path => runTool("set_onboarding_field", { path: `taxIds.${path}`, value: `synthetic-${path}` }, session, "")));
    expect(results.map(result => JSON.parse(result).ok)).toEqual([true, true, true, true]);
    const progress = JSON.parse(await runTool("lookup_user_progress", {}, session, ""));
    expect(progress.progress.payload.taxIds).toEqual({ federalTaxId: "synthetic-federalTaxId", stateTaxId: "synthetic-stateTaxId", physicalAddress: "synthetic-physicalAddress", billingAddress: "synthetic-billingAddress" });
  });
  it("blocks foreign payment data, limits worker tickets, and refuses member onboarding reads", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const suffix = randomUUID();
    const [user] = await db.insert(usersTable).values({ username: `read-scope-${suffix}`, passwordHash: "unused-isolated-fixture", displayName: "Isolated read fixture", role: "field_employee" }).returning();
    const vendors = await db.insert(vendorsTable).values([1, 2].map(n => ({ name: `scope-vendor-${n}-${suffix}`, contactName: "Isolated fixture", contactEmail: `v${n}-${suffix}@example.invalid` }))).returning();
    const partners = await db.insert(partnersTable).values([1, 2].map(n => ({ name: `scope-partner-${n}-${suffix}`, contactName: "Isolated fixture", contactEmail: `p${n}-${suffix}@example.invalid` }))).returning();
    const sites = await db.insert(siteLocationsTable).values(partners.map((partner, i) => ({ partnerId: partner.id, name: "Isolated site", address: "Synthetic", latitude: 0, longitude: 0, siteCode: `S${i}-${suffix}` }))).returning();
    const [workType] = await db.insert(workTypesTable).values({ name: `Scope fixture ${suffix}`, category: "service" }).returning();
    const [worker] = await db.insert(vendorPeopleTable).values({ vendorId: vendors[0].id, firstName: "Synthetic", lastName: "Worker", email: `${suffix}@example.invalid` }).returning();
    const tickets = await db.insert(ticketsTable).values(vendors.map((vendor, i) => ({ vendorId: vendor.id, siteLocationId: sites[i].id, workTypeId: workType.id, fieldEmployeeId: i === 0 ? worker.id : null, paymentReference: `private-payment-${i}-${suffix}` }))).returning();
    await db.insert(vendorPeopleTable).values([1, 2].map(n => ({ vendorId: vendors[1].id, firstName: "Foreign", lastName: `Crew ${n}`, email: `foreign-${n}-${suffix}@example.invalid` })));
    const foreignSchedule = await runTool("schedule_ticket_crew", { ticketId: tickets[1].id, crewMemberName: "Foreign", scheduledStartAt: "2026-10-10T12:00:00.000Z", confirmed: true }, { userId: user.id, role: "vendor", vendorId: vendors[0].id }, "");
    expect(JSON.parse(foreignSchedule)).toHaveProperty("error");
    expect(JSON.parse(foreignSchedule)).not.toHaveProperty("matches");
    expect(foreignSchedule).not.toContain("@example.invalid");
    for (const session of [{ userId: user.id, role: "vendor", vendorId: vendors[0].id }, { userId: user.id, role: "partner", partnerId: partners[0].id }]) {
      expect(JSON.parse(await runOpsDataTool("lookup_ticket_payment_status", { ticketId: tickets[0].id }, session))).toMatchObject({ id: tickets[0].id });
      const refused = await runOpsDataTool("lookup_ticket_payment_status", { ticketId: tickets[1].id }, session);
      expect(JSON.parse(refused)).toHaveProperty("error");
      expect(refused).not.toContain(tickets[1].paymentReference!);
    }
    const employee = { userId: user.id, role: "field_employee", vendorPeopleId: worker.id, vendorId: vendors[0].id };
    const visible = JSON.parse(await runTool("lookup_open_tickets", {}, employee, ""));
    expect(visible.tickets.map((ticket: { id: number }) => ticket.id)).toEqual([tickets[0].id]);
    expect(JSON.parse(await runTool("lookup_open_tickets", {}, { userId: user.id, role: "field_employee", vendorId: vendors[0].id }, ""))).toHaveProperty("error");
    expect(JSON.parse(await runTool("lookup_user_progress", {}, { userId: user.id, role: "vendor", vendorId: vendors[0].id, membershipRole: "member" }, ""))).toHaveProperty("error");
  });
});
