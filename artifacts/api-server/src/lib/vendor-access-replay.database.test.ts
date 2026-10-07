import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, vendorsTable, partnersTable, siteLocationsTable, workTypesTable, siteWorkAssignmentsTable,
  vendorPeopleTable, vendorPersonOperationalRolesTable, vendorPersonSiteAccessTable, usersTable } from "@workspace/db";
import { VENDOR_PERSON_ACCESS_MIGRATION } from "../../scripts/migrate-vendor-person-access.js";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")("vendor access migration replay", () => {
  it("preserves revoked roles and sites and does not broaden a selected site scope", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const tag = randomUUID();
    const [vendor] = await db.insert(vendorsTable).values({ name: `replay-${tag}`, contactName: "Synthetic", contactEmail: `${tag}@example.invalid` }).returning();
    const [partner] = await db.insert(partnersTable).values({ name: `replay-${tag}`, contactName: "Synthetic", contactEmail: `p-${tag}@example.invalid` }).returning();
    const sites = await db.insert(siteLocationsTable).values([1, 2, 3].map(n => ({ partnerId: partner.id, name: `Synthetic ${n}`, address: "Fixture", latitude: 0, longitude: 0, siteCode: `${n}-${tag}` }))).returning();
    const [workType] = await db.insert(workTypesTable).values({ name: `replay-${tag}`, category: "service" }).returning();
    await db.insert(siteWorkAssignmentsTable).values(sites.map(site => ({ vendorId: vendor.id, siteLocationId: site.id, workTypeId: workType.id })));
    const [person] = await db.insert(vendorPeopleTable).values({ vendorId: vendor.id, vendorRole: "gatekeeper", firstName: "Synthetic", email: `worker-${tag}@example.invalid` }).returning();
    await db.insert(vendorPersonOperationalRolesTable).values({ vendorPeopleId: person.id, role: "gatekeeper", isActive: false });
    await db.insert(vendorPersonSiteAccessTable).values(sites.slice(0, 2).map((site, n) => ({ vendorPeopleId: person.id, siteLocationId: site.id, isActive: n === 0 })));
    const [actor] = await db.insert(usersTable).values({ username: `actor-${tag}@example.invalid`, passwordHash: "synthetic-no-login", role: "vendor", displayName: "Synthetic grant author" }).returning();
    const [emptyScope] = await db.insert(vendorPeopleTable).values({ vendorId: vendor.id, vendorRole: "gatekeeper", firstName: "Synthetic empty scope", email: `empty-${tag}@example.invalid` }).returning();
    await db.insert(vendorPersonOperationalRolesTable).values({ vendorPeopleId: emptyScope.id, role: "gatekeeper", isActive: true, grantedByUserId: actor.id });
    const [legacy] = await db.insert(vendorPeopleTable).values({ vendorId: vendor.id, vendorRole: "gatekeeper", firstName: "Synthetic legacy", email: `legacy-${tag}@example.invalid` }).returning();
    await db.execute(sql.raw(VENDOR_PERSON_ACCESS_MIGRATION));
    await db.execute(sql.raw(VENDOR_PERSON_ACCESS_MIGRATION));
    expect((await db.select().from(vendorPersonOperationalRolesTable).where(eq(vendorPersonOperationalRolesTable.vendorPeopleId, person.id)))[0].isActive).toBe(false);
    const grants = await db.select().from(vendorPersonSiteAccessTable).where(eq(vendorPersonSiteAccessTable.vendorPeopleId, person.id));
    expect(grants.filter(grant => grant.isActive).map(grant => grant.siteLocationId)).toEqual([sites[0].id]);
    expect(grants.find(grant => grant.siteLocationId === sites[1].id)?.isActive).toBe(false);
    expect(grants.find(grant => grant.siteLocationId === sites[2].id)).toBeUndefined();
    expect(await db.select().from(vendorPersonSiteAccessTable).where(eq(vendorPersonSiteAccessTable.vendorPeopleId, emptyScope.id))).toEqual([]);
    const legacySites = await db.select().from(vendorPersonSiteAccessTable).where(eq(vendorPersonSiteAccessTable.vendorPeopleId, legacy.id));
    expect(legacySites.filter(grant => grant.isActive).map(grant => grant.siteLocationId).sort()).toEqual(sites.map(site => site.id).sort());
  });
});
