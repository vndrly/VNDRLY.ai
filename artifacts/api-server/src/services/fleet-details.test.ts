import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { PoolClient } from "pg";
import { emptyFleetState } from "./fleet-repository";

it("refuses a driver's configuration write before reading company resources", async () => {
  const module = await import("./fleet-details").catch(() => null);
  expect(module).not.toBeNull();
  const state = { ...emptyFleetState(), enabled: true };
  const service = module!.createFleetDetailsOperations(
    async (_actor, work) => work(state, {} as PoolClient),
    () => ({ fleetIds: [], roles: ["driver"] }),
  );
  await expect(
    service.saveFleetRigPackage({ userId: 42, companyId: 7 }, {}),
  ).rejects.toMatchObject({ code: "fleet.dispatch_required", status: 403 });
});

it("persists a new reusable Detail without a driver grant or driver lookup", async () => {
  const { createFleetDetailsOperations } = await import("./fleet-details");
  const group = randomUUID(),
    truck = randomUUID();
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: group,
        name: "Fleet",
        siteIds: [],
        equipmentAssetIds: [truck],
        requiredCertifications: [],
      },
    ],
    grants: [
      {
        userId: 42,
        fleetIds: [group],
        siteIds: [],
        roles: ["fleet_manager"],
        safetyRelease: false,
        financeRead: false,
      },
    ],
  };
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("SELECT fleet_resources"))
        return { rows: [{ fleet_resources: null }] };
      if (sql.includes("FROM assistant_action_audit")) return { rows: [] };
      if (sql.includes("FROM assets a"))
        return {
          rows: [
            {
              id: truck,
              name: "Truck",
              category: "truck",
              status: "available",
              responsible_org_type: "vendor",
              responsible_org_id: 7,
              current_holder_user_id: null,
              retired_at: null,
              merged_into_id: null,
              provisional: false,
              enrolled: true,
            },
          ],
        };
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const service = createFleetDetailsOperations(
    async (_actor, work) => work(state as any, client),
    () => state.grants[0],
  );
  const input = {
    operationId: randomUUID(),
    expectedVersion: 0,
    detail: {
      id: randomUUID(),
      companyId: 7,
      version: 1,
      name: "Reusable truck",
      vehicleAssetId: truck,
      rigPackageId: null,
      rigPackageVersion: null,
      driverUserId: null,
      accessGroupIds: [group],
      effectiveFrom: "2026-10-19T00:00:00Z",
      effectiveUntil: null,
      archivedAt: null,
    },
  };
  await expect(
    service.saveFleetDetail(
      { userId: 42, companyId: 7, role: "vendor", membershipRole: "member" },
      input,
    ),
  ).resolves.toEqual(input.detail);
  expect(
    queries.some((sql) => sql.includes("FROM users u JOIN vendor_people")),
  ).toBe(false);
});

it("captures a selected Run driver without changing the saved Detail", async () => {
  const { createFleetDetailsOperations } = await import("./fleet-details");
  const group = randomUUID(),
    truck = randomUUID(),
    detailId = randomUUID();
  const detail = {
    id: detailId,
    companyId: 7,
    version: 1,
    name: "Reusable truck",
    vehicleAssetId: truck,
    rigPackageId: null,
    rigPackageVersion: null,
    driverUserId: null,
    accessGroupIds: [group],
    effectiveFrom: "2026-10-19T00:00:00Z",
    effectiveUntil: null,
    archivedAt: null,
  };
  const state = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: group,
        name: "Fleet",
        siteIds: [],
        equipmentAssetIds: [truck],
        requiredCertifications: [],
      },
    ],
    grants: [42, 43].map((userId) => ({
      userId,
      fleetIds: [group],
      siteIds: [],
      roles: userId === 42 ? ["fleet_manager"] : ["driver"],
      safetyRelease: false,
      financeRead: false,
    })),
  };
  const client = {
    query: async (sql: string) => {
      if (sql.includes("SELECT fleet_resources"))
        return {
          rows: [
            {
              fleet_resources: {
                version: 1,
                rigPackages: [],
                details: [detail],
                reservations: [],
              },
            },
          ],
        };
      if (sql.includes("FROM assets a"))
        return {
          rows: [
            {
              id: truck,
              name: "Truck",
              category: "truck",
              status: "available",
              responsible_org_type: "vendor",
              responsible_org_id: 7,
              current_holder_user_id: null,
              retired_at: null,
              merged_into_id: null,
              provisional: false,
              enrolled: true,
            },
          ],
        };
      if (sql.includes("FROM users"))
        return { rows: [{ id: 43, display_name: "Casey" }] };
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const service = createFleetDetailsOperations(
    async (_actor, work) => work(state as any, client),
    (_state, actor) => state.grants.find((g) => g.userId === actor.userId)!,
  );
  const snapshot = await service.fleetDetailSnapshot(
    { userId: 42, companyId: 7, role: "vendor", membershipRole: "member" },
    detailId,
    43,
  );
  expect(snapshot.detail.driverUserId).toBe(43);
  expect(snapshot.labels.driver).toBe("Casey");
  expect(detail.driverUserId).toBeNull();
});
