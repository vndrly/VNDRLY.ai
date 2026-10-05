import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, vendorsTable, partnersTable, siteLocationsTable, workTypesTable, ticketsTable, vendorPeopleTable, usersTable } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { runOpsDataTool } from "./data-tools-ops";
import { runTool } from "../routes/assistant";

describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")("assistant read authorization against isolated records", () => {
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
