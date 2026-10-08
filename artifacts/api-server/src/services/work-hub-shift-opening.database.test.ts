import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
describe.skipIf(!isolated)("existing Gate claim-window PostgreSQL", () => {
  it("opens once, binds conflicts, preserves cancelled state and permits current eligible own claim", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const s = await import("@workspace/db"),
      { eq, and } = await import("drizzle-orm"),
      { setWorkHubShiftOpening, readWorkHubShiftOpening } =
        await import("./work-hub-shift-opening"),
      { executeGateShiftClaim, readGateShiftAssignment } =
        await import("./gate-shift-assignment");
    const target = new URL(process.env.DATABASE_URL!);
    expect(
      (
        await s.pool.query(
          "SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port",
        )
      ).rows[0],
    ).toEqual({
      database: process.env.VNDRLY_FRESH_TEST_DB_NAME,
      address: "127.0.0.1",
      port: Number(target.port),
    });
    const marker = randomUUID();
    const [vendor] = await s.db
      .insert(s.vendorsTable)
      .values({
        name: `Synthetic opening ${marker}`,
        contactName: "Synthetic",
        contactEmail: `${marker}@example.invalid`,
      })
      .returning();
    const [partner] = await s.db
      .insert(s.partnersTable)
      .values({
        name: `Synthetic partner ${marker}`,
        contactName: "Synthetic",
        contactEmail: `p.${marker}@example.invalid`,
      })
      .returning();
    const [site] = await s.db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partner!.id,
        name: "Synthetic opening",
        address: "Isolated",
        latitude: 30,
        longitude: -100,
        siteCode: `O-${marker}`,
      })
      .returning();
    const [station] = await s.db
      .insert(s.gateStationsTable)
      .values({ siteId: site!.id, name: "Synthetic" })
      .returning();
    const [type] = await s.db
      .insert(s.workTypesTable)
      .values({ name: `Synthetic ${marker}`, category: "gate" })
      .returning();
    await s.db
      .insert(s.siteWorkAssignmentsTable)
      .values({
        siteLocationId: site!.id,
        vendorId: vendor!.id,
        workTypeId: type!.id,
        isGateContractor: true,
      });
    await s.db
      .insert(s.partnerVendorRelationshipsTable)
      .values({
        partnerId: partner!.id,
        vendorId: vendor!.id,
        status: "approved",
      });
    const [admin, worker] = await s.db
      .insert(s.usersTable)
      .values([
        {
          username: `a.${marker}`,
          passwordHash: "unusable-synthetic",
          role: "vendor",
          displayName: "Synthetic manager",
        },
        {
          username: `w.${marker}`,
          passwordHash: "unusable-synthetic",
          role: "field_employee",
          displayName: "Synthetic worker",
        },
      ])
      .returning();
    const [person] = await s.db
      .insert(s.vendorPeopleTable)
      .values({
        vendorId: vendor!.id,
        userId: worker!.id,
        firstName: "Synthetic",
        lastName: "Worker",
        email: `w.${marker}@example.invalid`,
        vendorRole: "gatekeeper",
      })
      .returning();
    await s.db
      .insert(s.vendorPersonSiteAccessTable)
      .values({ vendorPeopleId: person!.id, siteLocationId: site!.id });
    const [am] = await s.db
      .insert(s.userOrgMembershipsTable)
      .values({
        userId: admin!.id,
        orgType: "vendor",
        vendorId: vendor!.id,
        role: "admin",
      })
      .returning();
    const [wm] = await s.db
      .insert(s.userOrgMembershipsTable)
      .values({
        userId: worker!.id,
        orgType: "vendor",
        vendorId: vendor!.id,
        vendorPeopleId: person!.id,
        role: "field_employee",
      })
      .returning();
    const actor = {
      userId: admin!.id,
      role: "vendor",
      vendorId: vendor!.id,
      membershipRole: "admin",
      activeMembershipId: am!.id,
      sv: admin!.sessionVersion,
    };
    const workerActor = {
      userId: worker!.id,
      role: "field_employee",
      vendorId: vendor!.id,
      membershipRole: "field_employee",
      activeMembershipId: wm!.id,
      vendorPeopleId: person!.id,
      vendorRole: "gatekeeper",
      sv: worker!.sessionVersion,
    };
    const startsAt = new Date(Date.now() + 86400000),
      endsAt = new Date(startsAt.getTime() + 3600000);
    await s.db
      .insert(s.workHubAvailabilityTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendor!.id,
        userId: worker!.id,
        startsAt,
        endsAt,
        available: true,
      });
    const [shift] = await s.db
      .insert(s.workHubShiftsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendor!.id,
        title: "Synthetic closed claim window",
        startsAt,
        endsAt,
        timezone: "UTC",
        siteLocationId: site!.id,
        gateStationId: station!.id,
        requiredStaffCount: 1,
        workStartPolicy: "on_site",
        qualificationCodes: [],
        createdById: admin!.id,
        open: false,
      })
      .returning();
    const body = {
      operationId: randomUUID(),
      owner: { type: "vendor" as const, id: vendor!.id },
      context: { kind: "gate" as const, id: site!.id },
      expectedVersion: 1,
      payloadVersion: 1 as const,
      payload: { action: "update", open: true },
    };
    await s.db
      .insert(s.workHubClientOperationsTable)
      .values({
        userId: admin!.id,
        commandKind: "shift.update",
        operationId: body.operationId,
        ownerOrgType: "vendor",
        ownerOrgId: vendor!.id,
        resultJson: { legacy: true },
        appliedAt: new Date(),
      });
    await expect(
      setWorkHubShiftOpening(workerActor, shift!.id, body, "ios"),
    ).rejects.toThrow();
    const [first, retry] = await Promise.all([
      setWorkHubShiftOpening(actor, shift!.id, body, "web"),
      setWorkHubShiftOpening(actor, shift!.id, body, "web"),
    ]);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      open: true,
      previousVersion: 1,
      resultingVersion: 2,
      physicalAttendanceVerified: false,
    });
    expect(
      await readWorkHubShiftOpening(actor, shift!.id, body.operationId),
    ).toEqual(first);
    await expect(
      setWorkHubShiftOpening(
        actor,
        shift!.id,
        { ...body, payload: { action: "update", open: false } },
        "web",
      ),
    ).rejects.toThrow();
    await expect(
      setWorkHubShiftOpening(
        actor,
        shift!.id,
        { ...body, operationId: randomUUID() },
        "web",
      ),
    ).rejects.toThrow("version_conflict");
    expect(
      await s.db
        .select()
        .from(s.workHubAuditLogTable)
        .where(
          and(
            eq(s.workHubAuditLogTable.subjectId, shift!.id),
            eq(s.workHubAuditLogTable.action, "shift.claim_window_changed"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await s.db
        .select()
        .from(s.workHubClientOperationsTable)
        .where(
          and(
            eq(s.workHubClientOperationsTable.userId, admin!.id),
            eq(s.workHubClientOperationsTable.operationId, body.operationId),
          ),
        ),
    ).toHaveLength(2);
    const claim = { operationId: randomUUID(), expectedVersion: 2 };
    const claimed = await executeGateShiftClaim(workerActor, shift!.id, claim);
    expect(claimed).toMatchObject({
      previousVersion: 2,
      resultingVersion: 3,
      assigneeUserIds: [worker!.id],
      physicalAttendanceVerified: false,
    });
    expect(
      (
        await readGateShiftAssignment(
          workerActor,
          shift!.id,
          claim.operationId,
          s.pool,
          true,
        )
      ).receipt,
    ).toEqual(claimed);
    expect(await executeGateShiftClaim(workerActor, shift!.id, claim)).toEqual(
      claimed,
    );
    expect(await setWorkHubShiftOpening(actor, shift!.id, body, "web")).toEqual(
      first,
    );
    const [cancelled] = await s.db
      .insert(s.workHubShiftsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendor!.id,
        title: "Synthetic cancelled",
        startsAt,
        endsAt,
        timezone: "UTC",
        siteLocationId: site!.id,
        gateStationId: station!.id,
        requiredStaffCount: 1,
        workStartPolicy: "on_site",
        qualificationCodes: [],
        createdById: admin!.id,
        open: false,
        milestoneStatus: "cancelled",
      })
      .returning();
    await expect(
      setWorkHubShiftOpening(
        actor,
        cancelled!.id,
        { ...body, operationId: randomUUID() },
        "web",
      ),
    ).rejects.toThrow("invalid_operation");
    expect(
      (
        await s.db
          .select()
          .from(s.workHubShiftsTable)
          .where(eq(s.workHubShiftsTable.id, cancelled!.id))
      )[0],
    ).toMatchObject({ open: false, version: 1, milestoneStatus: "cancelled" });
    const [race] = await s.db
      .insert(s.workHubShiftsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendor!.id,
        title: "Synthetic competing reviewed windows",
        startsAt,
        endsAt,
        timezone: "UTC",
        siteLocationId: site!.id,
        gateStationId: station!.id,
        requiredStaffCount: 1,
        workStartPolicy: "on_site",
        qualificationCodes: [],
        createdById: admin!.id,
        open: false,
      })
      .returning();
    const competing = await Promise.allSettled([
      setWorkHubShiftOpening(
        actor,
        race!.id,
        { ...body, operationId: randomUUID() },
        "web",
      ),
      setWorkHubShiftOpening(
        actor,
        race!.id,
        {
          ...body,
          operationId: randomUUID(),
          payload: { action: "update", open: false },
        },
        "web",
      ),
    ]);
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (
        await s.db
          .select()
          .from(s.workHubShiftsTable)
          .where(eq(s.workHubShiftsTable.id, race!.id))
      )[0]!.version,
    ).toBe(2);
    await s.db
      .update(s.usersTable)
      .set({ sessionVersion: admin!.sessionVersion + 1 })
      .where(eq(s.usersTable.id, admin!.id));
    await expect(
      readWorkHubShiftOpening(actor, shift!.id, body.operationId),
    ).rejects.toThrow();
  }, 20000);
});
