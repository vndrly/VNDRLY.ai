import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, vendorsTable, partnersTable, siteLocationsTable, workTypesTable, ticketsTable, vendorPeopleTable, usersTable, ticketCrewTable } from "@workspace/db";
import router from "./ticketSchedule";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("own ticket crew acknowledgements", () => {
  it("writes only the active caller assignment in the active vendor and rejects foreign, removed and impersonated assignments", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const tag = randomUUID();
    const vendors = await db.insert(vendorsTable).values([1, 2].map(n => ({ name: `ack-${n}-${tag}`, contactName: "Synthetic", contactEmail: `${n}-${tag}@example.invalid` }))).returning();
    const [partner] = await db.insert(partnersTable).values({ name: `ack-partner-${tag}`, contactName: "Synthetic", contactEmail: `p-${tag}@example.invalid` }).returning();
    const [site] = await db.insert(siteLocationsTable).values({ partnerId: partner.id, name: "Synthetic", address: "Fixture", latitude: 0, longitude: 0, siteCode: tag }).returning();
    const [workType] = await db.insert(workTypesTable).values({ name: `ack-type-${tag}`, category: "service" }).returning();
    const users = await db.insert(usersTable).values([1, 2].map(n => ({ username: `ack-user-${n}-${tag}`, passwordHash: "unused-isolated-fixture", displayName: "Synthetic worker", role: "field_employee" }))).returning();
    const people = await db.insert(vendorPeopleTable).values(users.map((user, n) => ({ vendorId: vendors[n].id, userId: user.id, firstName: "Synthetic", email: `worker-${n}-${tag}@example.invalid` }))).returning();
    const tickets = await db.insert(ticketsTable).values(vendors.map(vendor => ({ vendorId: vendor.id, siteLocationId: site.id, workTypeId: workType.id }))).returning();
    const crew = await db.insert(ticketCrewTable).values(people.map((person, n) => ({ ticketId: tickets[n].id, employeeId: person.id }))).returning();
    const app = express(); app.use(cookieParser()); app.use(express.json()); app.use("/api", router);
    const cookie = (vendorId: number, userId = users[0].id, role = "field_employee") => buildTestCookie({ userId, role, vendorId });
    const ack = (ticketId: number, auth: string, body = { status: "confirmed", note: "Ready" }) => request(app).post(`/api/tickets/${ticketId}/crew/ack`).set("Cookie", auth).send(body);
    await ack(tickets[0].id, cookie(vendors[1].id)).expect(403);
    await ack(tickets[1].id, cookie(vendors[0].id)).expect(403);
    await ack(tickets[0].id, cookie(vendors[0].id, users[1].id)).expect(403);
    await ack(tickets[0].id, cookie(vendors[0].id, users[0].id, "admin")).expect(403);
    await request(app).post(`/api/tickets/${tickets[0].id}/crew/ack`).set("Cookie", cookie(vendors[0].id)).send({ status: "confirmed", employeeId: people[1].id }).expect(200);
    expect((await db.select().from(ticketCrewTable).where(eq(ticketCrewTable.id, crew[0].id)))[0].ackStatus).toBe("confirmed");
    expect((await db.select().from(ticketCrewTable).where(eq(ticketCrewTable.id, crew[1].id)))[0].ackStatus).toBe("pending");
    await ack(tickets[0].id, cookie(vendors[0].id), { status: "declined", note: "Unavailable" }).expect(200);
    await db.update(ticketCrewTable).set({ removedAt: new Date() }).where(eq(ticketCrewTable.id, crew[0].id));
    await ack(tickets[0].id, cookie(vendors[0].id)).expect(403);
    expect((await db.select().from(ticketCrewTable).where(eq(ticketCrewTable.id, crew[0].id)))[0].ackStatus).toBe("declined");
  });
});
