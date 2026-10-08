import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
describe.skipIf(!isolated)("offline Gate canonical PostgreSQL", () => {
  it("saves entry and immutable receipt together, deduplicates concurrent retry, binds exit to entry and rechecks revocation", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const s = await import("@workspace/db"),
      { eq } = await import("drizzle-orm"),
      { offlineGateObservationService: api } =
        await import("./gate-offline-observation");
    const marker = randomUUID();
    const [vendor] = await s.db
      .insert(s.vendorsTable)
      .values({
        name: `Offline Gate ${marker}`,
        contactName: "Synthetic",
        contactEmail: `${marker}@example.invalid`,
      })
      .returning();
    const [partner] = await s.db
      .insert(s.partnersTable)
      .values({
        name: `Offline Gate Partner ${marker}`,
        contactName: "Synthetic",
        contactEmail: `p.${marker}@example.invalid`,
      })
      .returning();
    const [site] = await s.db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partner.id,
        name: "Offline Gate site",
        address: "Isolated",
        siteCode: `OG-${marker}`,
        latitude: 30,
        longitude: -100,
      })
      .returning();
    const [type] = await s.db
      .insert(s.workTypesTable)
      .values({ name: `Gate ${marker}`, category: "gate" })
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
    const [user] = await s.db
      .insert(s.usersTable)
      .values({
        username: `og-${marker}`,
        passwordHash: "unusable-synthetic",
        role: "vendor",
        displayName: "Offline gate synthetic staff",
      })
      .returning();
    const [membership] = await s.db
      .insert(s.userOrgMembershipsTable)
      .values({
        userId: user.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "admin",
      })
      .returning();
    const session = {
      userId: user.id,
      vendorId: vendor.id,
      role: "vendor",
      membershipRole: "admin",
      sv: user.sessionVersion,
    };
    const entry = {
      siteLocationId: site.id,
      direction: "entry",
      source: "gatekeeper",
      observedAt: new Date(Date.now() - 60000).toISOString(),
      operationId: randomUUID(),
      plate: "SYNTHETIC",
      reportedVisitor: {
        firstName: "Synthetic",
        lastName: "Visitor",
        company: "Synthetic company",
        purpose: "Offline reported entry",
      },
    };
    const [one, two] = await Promise.all([
      api.execute(session, entry),
      api.execute(session, entry),
    ]);
    expect(one.id).toBe(two.id);
    expect(one.admissionStatus).toBe("pending");
    expect(one.reconciliationState).toBe("needs_supervisor_review");
    expect(one.reconciliationFacts.firstName).toEqual({
      value: "Synthetic",
      source: "supplied_later",
    });
    expect(one.reconciliationFacts.operationId).toEqual({
      value: entry.operationId,
      source: "observed",
    });
    expect(
      (
        await s.pool.query(
          "SELECT count(*)::int AS n FROM assistant_action_audit WHERE target_type='gate-offline-observation' AND target_id=$1",
          [entry.operationId],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      api.execute(session, {
        ...entry,
        reportedVisitor: { firstName: "Changed", lastName: "Visitor" },
      }),
    ).rejects.toThrow("gate.observation_operation_conflict");
    const later = await api.execute(session, {
      ...entry,
      operationId: randomUUID(),
      observedAt: new Date(Date.now() - 30000).toISOString(),
    });
    await expect(
      api.execute(session, {
        siteLocationId: site.id,
        direction: "exit",
        source: "gatekeeper",
        operationId: randomUUID(),
        entryOperationId: entry.operationId,
        observedAt: new Date(Date.now() - 120000).toISOString(),
      }),
    ).rejects.toThrow("gate.exit_before_entry");
    const exit = {
      siteLocationId: site.id,
      direction: "exit",
      source: "gatekeeper",
      operationId: randomUUID(),
      entryOperationId: entry.operationId,
      observedAt: new Date().toISOString(),
    };
    const closed = await api.execute(session, exit);
    expect(closed.id).toBe(one.id);
    expect(closed.checkOutTime).toBeTruthy();
    const [untouched] = await s.db
      .select()
      .from(s.siteVisitsTable)
      .where(eq(s.siteVisitsTable.id, later.id));
    expect(untouched.checkOutTime).toBeNull();
    expect((await api.execute(session, exit)).id).toBe(one.id);
    await s.db
      .update(s.userOrgMembershipsTable)
      .set({ role: "member" })
      .where(eq(s.userOrgMembershipsTable.id, membership.id));
    await expect(api.execute(session, entry)).rejects.toThrow(
      "gate.person_no_access",
    );
  });
});
