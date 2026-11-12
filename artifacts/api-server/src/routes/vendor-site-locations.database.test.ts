import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("vendor site locations", () => {
  it("shares the ticket and Gate scope with Ask V and keeps first-ticket intake available", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const [{ db, ...schema }, { default: router }, { runOpsDataTool }] = await Promise.all([
      import("@workspace/db"), import("./siteLocations"), import("../assistant/data-tools-ops"),
    ]);
    const app = express().use(cookieParser()).use("/api", router);
    attachTestErrorMiddleware(app);
    const tag = randomUUID();
    const org = (name: string) => ({ name: `${tag}-${name}`, contactName: "Test", contactEmail: `${tag}-${name}@example.test` });
    const [partner, otherPartner] = await db.insert(schema.partnersTable)
      .values([org("partner"), org("other-partner")]).returning();
    const [vendor, otherVendor] = await db.insert(schema.vendorsTable)
      .values([org("vendor"), org("other-vendor")]).returning();
    const [workType] = await db.insert(schema.workTypesTable)
      .values({ name: `${tag}-Gatekeeping`, category: "Gatekeeping" }).returning();
    await db.insert(schema.partnerVendorRelationshipsTable)
      .values({ vendorId: vendor.id, partnerId: partner.id, status: "approved" });

    const site = (name: string) => ({ partnerId: partner.id, name, address: "Test", latitude: 31, longitude: -102, siteCode: `${tag}-${name}` });
    const [ticketed, gate, intake, catalog, cancelled, hidden, unapproved, invited, declined] = await db.insert(schema.siteLocationsTable).values([
      site("Ticketed"), site("Assigned Gate"), site("Assigned for intake"), site("Catalog only"), site("Cancelled"),
      { ...site("Hidden"), hidden: true }, { ...site("Unapproved"), partnerId: otherPartner.id }, site("Invited"), site("Declined"),
    ]).returning();
    const assignment = (siteLocationId: number, isGateContractor: boolean) => ({
      siteLocationId, isGateContractor, vendorId: vendor.id, workTypeId: workType.id,
    });
    await db.insert(schema.siteWorkAssignmentsTable).values([
      assignment(ticketed.id, false), assignment(gate.id, true), assignment(intake.id, false), assignment(unapproved.id, true),
    ]);
    const ticket = (siteLocationId: number, vendorId: number, status = "initiated") => ({ siteLocationId, vendorId, status, workTypeId: workType.id });
    await db.insert(schema.ticketsTable).values([
      ticket(ticketed.id, vendor.id, "completed"), ticket(ticketed.id, vendor.id), ticket(catalog.id, otherVendor.id),
      ticket(cancelled.id, vendor.id, "cancelled"), ticket(hidden.id, vendor.id),
      ticket(invited.id, vendor.id, "awaiting_acceptance"), ticket(declined.id, vendor.id, "denied"),
      ticket(gate.id, vendor.id, "awaiting_acceptance"), ticket(catalog.id, otherVendor.id, "awaiting_acceptance"),
    ]);

    const session = { role: "vendor", vendorId: vendor.id, userId: 1 } as const;
    const cookie = buildTestCookie(session);
    const list = (path = "/api/site-locations") => request(app).get(path).set("Cookie", cookie).expect(200);
    const ids = (rows: Array<{ id: number }>) => rows.map(({ id }) => id).sort((a, b) => a - b);
    const expected = [ticketed.id, gate.id];
    expect(ids((await list()).body)).toEqual(expected);
    expect(ids((await list("/api/site-locations?purpose=ticket_creation")).body)).toEqual([...expected, intake.id]);
    expect((await list(`/api/site-locations?partnerId=${otherPartner.id}`)).body).toEqual([]);
    const found = JSON.parse(await runOpsDataTool("query_site_locations", {}, session));
    expect(ids(found.rows)).toEqual([...expected, invited.id]);
    expect(found.rows.find((row: { id: number }) => row.id === invited.id)).toEqual({
      id: invited.id, name: invited.name, partnerId: partner.id, status: "offer_pending",
    });
    expect((await list("/api/site-locations/offer-previews")).body).toEqual([
      { id: invited.id, name: invited.name, partnerId: partner.id, partnerName: partner.name },
    ]);
    await request(app).get(`/api/site-locations/${invited.id}`).set("Cookie", cookie).expect(403);
    expect(JSON.parse(await runOpsDataTool("lookup_site_detail", { siteId: invited.id }, session))).toHaveProperty("error");
    await request(app).get(`/api/site-locations/${intake.id}/assignments`).set("Cookie", cookie).expect(200);
    await request(app).get(`/api/site-locations/${catalog.id}`).set("Cookie", cookie).expect(403);
    const ownerList = await request(app).get("/api/site-locations")
      .set("Cookie", buildTestCookie({ role: "partner", partnerId: partner.id, userId: 2 })).expect(200);
    expect(ids(ownerList.body)).toEqual([ticketed.id, gate.id, intake.id, catalog.id, cancelled.id, invited.id, declined.id]);

    await db.insert(schema.ticketsTable).values(ticket(intake.id, vendor.id));
    await db.update(schema.ticketsTable).set({ status: "initiated" }).where(eq(schema.ticketsTable.siteLocationId, invited.id));
    expect(ids((await list()).body)).toEqual([...expected, intake.id, invited.id]);
    expect((await list("/api/site-locations/offer-previews")).body).toEqual([]);
    const accepted = JSON.parse(await runOpsDataTool("query_site_locations", { search: invited.name }, session));
    expect(accepted.rows).toEqual([expect.objectContaining({ id: invited.id, siteCode: invited.siteCode })]);
  });
});
