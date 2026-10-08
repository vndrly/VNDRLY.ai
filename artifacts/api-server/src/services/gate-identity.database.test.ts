import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const objects = vi.hoisted(() => new Map<string, any>());
vi.mock("../lib/objectStore", () => ({
  getObjectStore: () => ({
    getObject: async (path: string) => objects.get(path) ?? null,
    setAcl: async (path: string, acl: any) => {
      const object = objects.get(path);
      if (!object) throw new Error("missing");
      object.acl = acl;
      return path;
    },
    deleteObject: async (path: string) => {
      objects.delete(path);
    },
  }),
}));
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
describe.skipIf(!isolated)("Gate identity private PostgreSQL evidence", () => {
  it("saves only reviewed own evidence, checks current Gate scope and denies owner bypass at deadline before physical purge", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const s = await import("@workspace/db"),
      { eq } = await import("drizzle-orm"),
      {
        saveGateIdentity,
        readGateIdentity,
        canReadGateIdentityObject,
        purgeExpiredGateIdentityImages,
      } = await import("./gate-identity");
    const marker = randomUUID();
    const [vendor, foreign] = await s.db
      .insert(s.vendorsTable)
      .values([
        {
          name: `ID Gate ${marker}`,
          contactName: "Synthetic",
          contactEmail: `v.${marker}@example.invalid`,
        },
        {
          name: `ID Foreign ${marker}`,
          contactName: "Synthetic",
          contactEmail: `f.${marker}@example.invalid`,
        },
      ])
      .returning();
    const [partner] = await s.db
      .insert(s.partnersTable)
      .values({
        name: `ID Partner ${marker}`,
        contactName: "Synthetic",
        contactEmail: `p.${marker}@example.invalid`,
      })
      .returning();
    const [site] = await s.db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partner.id,
        name: "ID isolated site",
        address: "Isolated",
        siteCode: `ID-${marker}`,
        latitude: 30,
        longitude: -100,
      })
      .returning();
    const [type] = await s.db
      .insert(s.workTypesTable)
      .values({ name: `ID Gate ${marker}`, category: "gate" })
      .returning();
    await s.db
      .insert(s.siteWorkAssignmentsTable)
      .values({
        siteLocationId: site.id,
        vendorId: vendor.id,
        workTypeId: type.id,
        isGateContractor: true,
      });
    await s.db
      .insert(s.partnerVendorRelationshipsTable)
      .values({
        partnerId: partner.id,
        vendorId: vendor.id,
        status: "approved",
      });
    const [gate, other, member] = await s.db
      .insert(s.usersTable)
      .values([
        {
          username: `ig-${marker}`,
          passwordHash: "unusable-synthetic",
          role: "vendor",
          displayName: "ID gate",
        },
        {
          username: `if-${marker}`,
          passwordHash: "unusable-synthetic",
          role: "vendor",
          displayName: "ID foreign",
        },
        {
          username: `im-${marker}`,
          passwordHash: "unusable-synthetic",
          role: "vendor",
          displayName: "ID ordinary",
        },
      ])
      .returning();
    await s.db.insert(s.userOrgMembershipsTable).values([
      {
        userId: gate.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "admin",
      },
      {
        userId: other.id,
        orgType: "vendor",
        vendorId: foreign.id,
        role: "admin",
      },
      {
        userId: member.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "member",
      },
    ]);
    const session = {
        userId: gate.id,
        sv: gate.sessionVersion,
        vendorId: vendor.id,
        role: "vendor",
        membershipRole: "admin",
      },
      foreignSession = {
        userId: other.id,
        sv: other.sessionVersion,
        vendorId: foreign.id,
        role: "vendor",
        membershipRole: "admin",
      },
      ordinary = {
        userId: member.id,
        sv: member.sessionVersion,
        vendorId: vendor.id,
        role: "vendor",
      };
    const [visit] = await s.db
      .insert(s.siteVisitsTable)
      .values({
        siteLocationId: site.id,
        firstName: "Synthetic",
        lastName: "Visitor",
        hostType: "partner",
        hostPartnerId: partner.id,
        checkInTime: new Date(),
      })
      .returning();
    const path = "/objects/uploads/" + randomUUID(),
      body = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    objects.set(path, {
      body,
      size: body.length,
      contentType: "image/png",
      acl: { owner: String(gate.id), visibility: "private" },
    });
    const input = {
      operationId: randomUUID(),
      objectPath: path,
      capturedAt: new Date().toISOString(),
      reviewConfirmed: true,
      source: "visionkit_document_scan",
      fields: {
        firstName: "Synthetic",
        lastName: "Visitor",
        documentType: "Synthetic ID",
        issuingRegion: "TEST",
        documentLastFour: "1234",
      },
    };
    await expect(
      saveGateIdentity(session, visit.id, { ...input, reviewConfirmed: false }),
    ).rejects.toThrow();
    await expect(
      saveGateIdentity(foreignSession, visit.id, input),
    ).rejects.toThrow("gate.site_no_access");
    await expect(saveGateIdentity(ordinary, visit.id, input)).rejects.toThrow(
      "gate.person_no_access",
    );
    const [saved, retry] = await Promise.all([
      saveGateIdentity(session, visit.id, input),
      saveGateIdentity(session, visit.id, input),
    ]);
    expect(saved.operationId).toBe(retry.operationId);
    expect(objects.get(path).acl.purpose).toBe("gate-id");
    expect(await canReadGateIdentityObject(session, path)).toBe(true);
    expect(await canReadGateIdentityObject(ordinary, path)).toBe(false);
    expect(await canReadGateIdentityObject(foreignSession, path)).toBe(false);
    await expect(
      saveGateIdentity(session, visit.id, {
        ...input,
        fields: { ...input.fields, lastName: "Changed" },
      }),
    ).rejects.toThrow("Identity document operation conflict");
    const now = new Date();
    await s.db
      .update(s.siteVisitsTable)
      .set({
        checkInTime: new Date(now.getTime() - 31 * 86400000),
        checkOutTime: new Date(now.getTime() - 31 * 86400000),
      })
      .where(eq(s.siteVisitsTable.id, visit.id));
    const expired = await readGateIdentity(session, visit.id);
    expect(expired.imageAvailable).toBe(false);
    expect(expired.objectPath).toBeNull();
    expect(await canReadGateIdentityObject(session, path)).toBe(false);
    expect(objects.has(path)).toBe(true);
    expect(await purgeExpiredGateIdentityImages(now)).toBeGreaterThanOrEqual(1);
    expect(objects.has(path)).toBe(false);
    const [record] = await s.db
      .select()
      .from(s.siteVisitsTable)
      .where(eq(s.siteVisitsTable.id, visit.id));
    expect((record.gateIdentityDocument as any).fields.documentLastFour).toBe(
      "1234",
    );
    expect((record.gateIdentityDocument as any).objectPath).toBeUndefined();
    expect((record.gateIdentityDocument as any).imageDeletedAt).toBeTruthy();
    expect(await canReadGateIdentityObject(session, path)).toBe(false);
    expect(await purgeExpiredGateIdentityImages(now)).toBe(0);
  });
});
