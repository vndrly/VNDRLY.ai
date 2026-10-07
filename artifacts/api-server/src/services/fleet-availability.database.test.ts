import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { instrumentPoolConnect } from "../test-utils/instrument-pool-connect";
import type { PoolClient } from "pg";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)(
  "Fleet availability current PostgreSQL boundary",
  () => {
    it("serializes both dispatch/availability and dispatch/Gate race orders with exact receipts and current authority", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const s = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const { createFleetService } = await import("./fleet-ops");
      const { databaseFleetRepository } = await import("./fleet-repository");
      const { executeGateShiftAssignment } =
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
      const tag = randomUUID();
      const [vendor] = await s.db
        .insert(s.vendorsTable)
        .values({
          name: `Synthetic Fleet availability ${tag}`,
          contactName: "Synthetic",
          contactEmail: `${tag}@example.invalid`,
        })
        .returning();
      const [partner] = await s.db
        .insert(s.partnersTable)
        .values({
          name: `Synthetic Fleet site ${tag}`,
          contactName: "Synthetic",
          contactEmail: `p.${tag}@example.invalid`,
        })
        .returning();
      const [site] = await s.db
        .insert(s.siteLocationsTable)
        .values({
          partnerId: partner.id,
          name: `Synthetic Fleet site ${tag}`,
          address: "Isolated fixture",
          latitude: 30,
          longitude: -100,
          siteCode: `FA-${tag}`,
        })
        .returning();
      const [station] = await s.db
        .insert(s.gateStationsTable)
        .values({ siteId: site.id, name: "Synthetic Gate" })
        .returning();
      const [workType] = await s.db
        .insert(s.workTypesTable)
        .values({ name: `Synthetic Gate ${tag}`, category: "gate" })
        .returning();
      await s.db
        .insert(s.siteWorkAssignmentsTable)
        .values({
          siteLocationId: site.id,
          vendorId: vendor.id,
          workTypeId: workType.id,
          isGateContractor: true,
        });
      await s.db
        .insert(s.partnerVendorRelationshipsTable)
        .values({
          partnerId: partner.id,
          vendorId: vendor.id,
          status: "approved",
        });
      const [manager, driver] = await s.db
        .insert(s.usersTable)
        .values([
          {
            username: `fa-manager-${tag}`,
            passwordHash: "synthetic-unusable",
            role: "vendor",
            displayName: "Synthetic manager",
          },
          {
            username: `fa-driver-${tag}`,
            passwordHash: "synthetic-unusable",
            role: "field_employee",
            displayName: "Synthetic driver",
          },
        ])
        .returning();
      const [person] = await s.db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: driver.id,
          firstName: "Synthetic driver",
          email: `d.${tag}@example.invalid`,
          vendorRole: "gatekeeper",
        })
        .returning();
      await s.db
        .insert(s.vendorPersonSiteAccessTable)
        .values({ vendorPeopleId: person.id, siteLocationId: site.id });
      const [managerMembership] = await s.db
        .insert(s.userOrgMembershipsTable)
        .values({
          userId: manager.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "admin",
        })
        .returning();
      const [driverMembership] = await s.db
        .insert(s.userOrgMembershipsTable)
        .values({
          userId: driver.id,
          orgType: "vendor",
          vendorId: vendor.id,
          vendorPeopleId: person.id,
          role: "field_employee",
        })
        .returning();
      const [vehicle] = await s.db
        .insert(s.assetsTable)
        .values({
          name: "Synthetic truck",
          category: "truck",
          legalOwnerName: "Synthetic",
          responsibleOrgType: "vendor",
          responsibleOrgId: vendor.id,
        })
        .returning();
      const actor = () => ({
        userId: manager.id,
        companyId: vendor.id,
        role: "vendor",
        membershipRole: "admin",
        activeMembershipId: managerMembership.id,
        sv: manager.sessionVersion,
      });
      const driverActor = () => ({
        userId: driver.id,
        companyId: vendor.id,
        role: "field_employee",
        membershipRole: "field_employee",
        activeMembershipId: driverMembership.id,
        vendorPeopleId: person.id,
        sv: driver.sessionVersion,
      });
      const session = {
        userId: manager.id,
        vendorId: vendor.id,
        role: "vendor",
        membershipRole: "admin",
        activeMembershipId: managerMembership.id,
        sv: manager.sessionVersion,
      };
      const service = createFleetService(databaseFleetRepository),
        fleetId = randomUUID();
      await service.setup(actor(), {
        expectedVersion: 1,
        enabled: true,
        fleets: [
          {
            id: fleetId,
            name: "Synthetic Fleet",
            siteIds: [site.id],
            requiredCertifications: [],
            equipmentAssetIds: [vehicle.id],
          },
        ],
        grants: [
          {
            userId: manager.id,
            fleetIds: [fleetId],
            siteIds: [site.id],
            roles: ["fleet_manager", "dispatcher"],
            safetyRelease: false,
            financeRead: false,
          },
          {
            userId: driver.id,
            fleetIds: [fleetId],
            siteIds: [site.id],
            roles: ["driver"],
            safetyRelease: false,
            financeRead: false,
          },
        ],
      });
      expect(
        (await service.driverAvailability(driverActor(), driver.id)).canManage,
      ).toBe(false);
      const make = async (day: number) => {
        const startsAt = new Date(Date.now() + day * 86400000),
          endsAt = new Date(startsAt.getTime() + 3600000);
        const window = {
          plannedStartAt: startsAt.toISOString(),
          plannedEndAt: endsAt.toISOString(),
          timezone: "UTC",
        };
        const current = await service.driverAvailability(actor(), driver.id);
        const evidence = await service.recordDriverAvailability(actor(), {
          operationId: randomUUID(),
          driverUserId: driver.id,
          recordId: null,
          expectedFingerprint: current.fingerprint,
          window,
          available: true,
        });
        const run = await service.create(actor(), {
          operationId: randomUUID(),
          fleetId,
          title: "Synthetic scheduled run",
          driverUserId: driver.id,
          vehicleAssetId: vehicle.id,
          schedule: window,
          stops: ["pickup", "delivery"].map((kind, sequence) => ({
            id: randomUUID(),
            kind,
            sequence,
            siteId: site.id,
          })),
        });
        const [shift] = await s.db
          .insert(s.workHubShiftsTable)
          .values({
            ownerOrgType: "vendor",
            ownerOrgId: vendor.id,
            title: "Synthetic Gate",
            startsAt,
            endsAt,
            timezone: "UTC",
            siteLocationId: site.id,
            gateStationId: station.id,
            requiredStaffCount: 1,
            workStartPolicy: "on_site",
            qualificationCodes: [],
            createdById: manager.id,
          })
          .returning();
        const snapshot = await service.driverAvailability(actor(), driver.id);
        return {
          run,
          shift,
          unavailable: {
            operationId: randomUUID(),
            driverUserId: driver.id,
            recordId: evidence.record.id,
            expectedFingerprint: snapshot.fingerprint,
            window,
            available: false,
          },
          dispatch: {
            operationId: randomUUID(),
            expectedVersion: run.version,
            action: "dispatch",
          },
          assign: {
            operationId: randomUUID(),
            expectedVersion: shift.version,
            assigneeUserIds: [driver.id],
          },
        };
      };
      // Wrap only the two real transaction connections. Preserve QueryConfig,
      // rowMode, parameters and callbacks for all other pg calls unchanged.
      const ordered = async (
        first: () => Promise<unknown>,
        second: () => Promise<unknown>,
      ) => {
        const connect = s.pool.connect.bind(s.pool);
        let release!: () => void,
          locked!: () => void,
          waiting!: () => void,
          count = 0;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const acquired = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          waiting = resolve;
        });
        const spy = vi
          .spyOn(s.pool, "connect")
          .mockImplementation(instrumentPoolConnect(connect as (...args: unknown[]) => unknown, (rawClient) => {
            const client = rawClient as PoolClient,
              index = count++,
              original = client.query.bind(client);
            if (index > 1) return client;
            let seen = false;
            return {
              release: () => client.release(),
              query: (...args: unknown[]) => {
                const query = args[0],
                  text =
                    typeof query === "string"
                      ? query
                      : (query as { text: string }).text;
                if (
                  !seen &&
                  text.includes("FROM users") &&
                  text.includes("FOR UPDATE")
                ) {
                  seen = true;
                  if (index === 1) waiting();
                  return (async () => {
                    const result = await (
                      original as (...a: unknown[]) => Promise<unknown>
                    )(...args);
                    if (index === 0) {
                      locked();
                      await held;
                    }
                    return result;
                  })();
                }
                return (original as (...a: unknown[]) => unknown)(...args);
              },
            };
          }) as never);
        const a = first();
        let b: Promise<unknown> | undefined;
        try {
          await Promise.race([
            acquired,
            a.then(() => {
              throw Error("First operation missed user lock barrier");
            }),
          ]);
          b = second();
          await Promise.race([
            blocked,
            b.then(() => {
              throw Error("Second operation missed user lock barrier");
            }),
          ]);
          release();
          return await Promise.allSettled([a, b]);
        } finally {
          release();
          await Promise.allSettled([a, ...(b ? [b] : [])]);
          spy.mockRestore();
        }
      };
      for (const firstKind of [
        "dispatch",
        "availability",
        "fleet_before_gate",
        "gate_before_fleet",
      ] as const) {
        const f = await make(
          30 +
            [
              "dispatch",
              "availability",
              "fleet_before_gate",
              "gate_before_fleet",
            ].indexOf(firstKind) *
              10,
        );
        const dispatch = () => service.action(actor(), f.run.id, f.dispatch);
        const edit = () =>
          service.recordDriverAvailability(actor(), f.unavailable);
        const gate = () =>
          executeGateShiftAssignment(session, f.shift.id, f.assign);
        const [a, b] = await ordered(
          firstKind === "availability"
            ? edit
            : firstKind === "gate_before_fleet"
              ? gate
              : dispatch,
          firstKind === "dispatch"
            ? edit
            : firstKind === "availability" || firstKind === "gate_before_fleet"
              ? dispatch
              : gate,
        );
        expect(a.status, firstKind).toBe("fulfilled");
        expect(b.status, firstKind).toBe("rejected");
        if (b.status === "rejected")
          expect(String(b.reason)).toMatch(
            /schedule_conflict|assignment_conflict/,
          );
        const fresh = await service.detail(actor(), f.run.id);
        if (fresh.status === "dispatched") {
          expect(
            await service.action(actor(), f.run.id, f.dispatch),
          ).toMatchObject({ id: f.run.id, version: fresh.version });
          await service.action(actor(), f.run.id, {
            operationId: randomUUID(),
            expectedVersion: fresh.version,
            action: "cancel",
          });
        }
        if (firstKind === "gate_before_fleet") {
          await expect(edit()).rejects.toThrow("driver_schedule_conflict");
          await s.db
            .update(s.workHubShiftsTable)
            .set({ milestoneStatus: "cancelled" })
            .where(eq(s.workHubShiftsTable.id, f.shift.id));
          expect(await edit()).toMatchObject({
            driverUserId: driver.id,
            record: { available: false },
          });
        }
      }
      const current = await service.driverAvailability(actor(), driver.id);
      const command = {
        operationId: randomUUID(),
        driverUserId: driver.id,
        recordId: null,
        expectedFingerprint: current.fingerprint,
        window: {
          plannedStartAt: "2099-10-01T10:00:00.000Z",
          plannedEndAt: "2099-10-01T11:00:00.000Z",
          timezone: "UTC",
        },
        available: true,
      };
      const receipt = await service.recordDriverAvailability(actor(), command);
      expect(await service.recordDriverAvailability(actor(), command)).toEqual(
        receipt,
      );
      expect(
        (
          await service.driverAvailabilityOperation(
            actor(),
            driver.id,
            command.operationId,
          )
        ).receipt,
      ).toEqual(receipt);
      expect(
        (
          await s.pool.query(
            "SELECT id FROM assistant_action_audit WHERE target_type='fleet-availability-operation' AND target_id=$1",
            [command.operationId],
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        service.recordDriverAvailability(actor(), {
          ...command,
          available: false,
        }),
      ).rejects.toThrow("operation_conflict");
      await expect(
        service.recordDriverAvailability(driverActor(), {
          ...command,
          operationId: randomUUID(),
        }),
      ).rejects.toThrow("dispatch_required");
      const [replacement] = await s.db
        .insert(s.usersTable)
        .values({
          username: `fa-replacement-${tag}`,
          passwordHash: "synthetic-unusable",
          role: "field_employee",
          displayName: "Synthetic replacement",
        })
        .returning();
      const [replacementPerson] = await s.db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: replacement.id,
          firstName: "Synthetic replacement",
          email: `r.${tag}@example.invalid`,
          vendorRole: "field",
        })
        .returning();
      await s.db
        .insert(s.userOrgMembershipsTable)
        .values({
          userId: replacement.id,
          orgType: "vendor",
          vendorId: vendor.id,
          vendorPeopleId: replacementPerson.id,
          role: "field_employee",
        });
      await s.pool.query(
        "UPDATE vendors SET fleet_ops_state=jsonb_set(fleet_ops_state,'{grants}',(fleet_ops_state->'grants') || $2::jsonb) WHERE id=$1",
        [
          vendor.id,
          JSON.stringify([
            {
              userId: replacement.id,
              fleetIds: [fleetId],
              siteIds: [site.id],
              roles: ["driver"],
              safetyRelease: false,
              financeRead: false,
            },
          ]),
        ],
      );
      const reassignedRun = await service.create(actor(), {
        operationId: randomUUID(),
        fleetId,
        title: "Synthetic reassignment",
        driverUserId: driver.id,
        vehicleAssetId: vehicle.id,
        schedule: command.window,
        stops: ["pickup", "delivery"].map((kind, sequence) => ({
          id: randomUUID(),
          kind,
          sequence,
          siteId: site.id,
        })),
      });
      const dispatched = await service.action(actor(), reassignedRun.id, {
        operationId: randomUUID(),
        expectedVersion: reassignedRun.version,
        action: "dispatch",
      });
      const reassign = {
        operationId: randomUUID(),
        expectedVersion: dispatched.version,
        action: "reassign",
        driverUserId: replacement.id,
      };
      await expect(
        service.action(actor(), reassignedRun.id, reassign),
      ).rejects.toThrow("availability_unknown");
      const replacementSnapshot = await service.driverAvailability(
        actor(),
        replacement.id,
      );
      await service.recordDriverAvailability(actor(), {
        ...command,
        operationId: randomUUID(),
        driverUserId: replacement.id,
        expectedFingerprint: replacementSnapshot.fingerprint,
      });
      const replaced = await service.action(
        actor(),
        reassignedRun.id,
        reassign,
      );
      expect(replaced).toMatchObject({
        driverUserId: replacement.id,
        version: dispatched.version + 1,
      });
      expect(
        await service.action(actor(), reassignedRun.id, reassign),
      ).toMatchObject({
        driverUserId: replacement.id,
        version: replaced.version,
      });
      await expect(
        service.action(actor(), reassignedRun.id, {
          ...reassign,
          driverUserId: driver.id,
        }),
      ).rejects.toThrow("operation_conflict");
      await service.action(actor(), reassignedRun.id, {
        operationId: randomUUID(),
        expectedVersion: replaced.version,
        action: "cancel",
      });
      const changedWindowRun = await service.create(actor(), {
        operationId: randomUUID(),
        fleetId,
        title: "Synthetic changed window",
        driverUserId: driver.id,
        vehicleAssetId: vehicle.id,
        schedule: {
          ...command.window,
          plannedStartAt: "2099-10-02T10:00:00.000Z",
          plannedEndAt: "2099-10-02T11:00:00.000Z",
        },
        stops: ["pickup", "delivery"].map((kind, sequence) => ({
          id: randomUUID(),
          kind,
          sequence,
          siteId: site.id,
        })),
      });
      await expect(
        service.action(actor(), changedWindowRun.id, {
          operationId: randomUUID(),
          expectedVersion: changedWindowRun.version,
          action: "dispatch",
        }),
      ).rejects.toThrow("availability_unknown");
      await s.db
        .update(s.userOrgMembershipsTable)
        .set({ role: "member" })
        .where(eq(s.userOrgMembershipsTable.id, managerMembership.id));
      await expect(
        service.recordDriverAvailability(actor(), command),
      ).rejects.toThrow("membership_required");
      await expect(
        service.driverAvailabilityOperation(
          actor(),
          driver.id,
          command.operationId,
        ),
      ).rejects.toThrow("membership_required");
    }, 45000);
  },
);
