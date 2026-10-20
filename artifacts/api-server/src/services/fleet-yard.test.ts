import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { emptyFleetState } from "./fleet-repository";

const id = () => randomUUID();

describe("Yard workflow decisions", () => {
  it("keeps report outcomes advisory and records a substituted asset", async () => {
    const api = await import("./fleet-yard");
    const requested = id(),
      actual = id();
    const order = {
      id: id(),
      companyId: 7,
      version: 3,
      yardId: id(),
      detailId: null,
      runId: null,
      status: "in_progress" as const,
      outcome: null,
      requestedByUserId: 11,
      assignedToUserId: 12,
      requestedAt: "2026-10-19T10:00:00Z",
      scheduledAt: null,
      startedAt: "2026-10-19T10:05:00Z",
      reportedAt: null,
      requestedAssetIds: [requested],
      actualAssetIds: [],
      findings: [],
      notes: "",
    };
    const next = api.transitionYardOrder(
      order,
      {
        kind: "report",
        operationId: id(),
        expectedVersion: 3,
        scope: {
          owner: { type: "vendor", id: 7 },
          userId: 12,
          membershipId: 5,
          sessionVersion: 1,
        },
        orderId: order.id,
        outcome: "needs_attention",
        actualAssetIds: [actual],
        findings: [
          { assetId: requested, kind: "substituted", note: "Swap approved" },
        ],
        notes: "Swap approved",
      },
      new Date("2026-10-19T10:10:00Z"),
    );
    expect(next).toMatchObject({
      status: "reported",
      outcome: "needs_attention",
      version: 4,
      requestedAssetIds: [requested],
      actualAssetIds: [actual],
      reportedAt: "2026-10-19T10:10:00.000Z",
    });
    expect(next).not.toHaveProperty("ticketStatus");
    expect(() =>
      api.transitionYardOrder(
        order,
        {
          kind: "start",
          operationId: id(),
          expectedVersion: 2,
          scope: {
            owner: { type: "vendor", id: 7 },
            userId: 12,
            membershipId: 5,
            sessionVersion: 1,
          },
          orderId: order.id,
        },
        new Date(),
      ),
    ).toThrow();
  });

  it.each(["ready", "needs_attention", "unable_to_complete"] as const)(
    "records %s as a Yard outcome without changing ticket authority",
    async (outcome) => {
      const { transitionYardOrder } = await import("./fleet-yard");
      const orderId = id();
      const current = {
        id: orderId,
        companyId: 7,
        version: 2,
        yardId: null,
        detailId: null,
        runId: null,
        status: "in_progress" as const,
        outcome: null,
        requestedByUserId: 11,
        assignedToUserId: 12,
        requestedAt: "2026-10-19T10:00:00Z",
        scheduledAt: null,
        startedAt: "2026-10-19T10:05:00Z",
        reportedAt: null,
        requestedAssetIds: [],
        actualAssetIds: [],
        findings: [],
        notes: "",
      };
      const result = transitionYardOrder(
        current,
        {
          kind: "report",
          operationId: id(),
          expectedVersion: 2,
          orderId,
          outcome,
          notes: "Observed",
          scope: {
            owner: { type: "vendor", id: 7 },
            userId: 12,
            membershipId: 5,
            sessionVersion: 1,
          },
        },
        new Date("2026-10-19T10:10:00Z"),
      );
      expect(result).toMatchObject({ status: "reported", outcome, version: 3 });
      expect(result).not.toHaveProperty("ticketStatus");
    },
  );

  it("offers only co-located unreserved resources and explains exclusions", async () => {
    const api = await import("./fleet-yard");
    const yard = id(),
      truck = id(),
      rig = id(),
      elsewhere = id();
    const ranked = api.suggestYardResources({
      yardId: yard,
      vehicleAssetId: truck,
      rigPackageId: rig,
      window: {
        startAt: "2026-10-20T12:00:00Z",
        endAt: "2026-10-20T14:00:00Z",
      },
      candidates: [
        { assetId: truck, yardId: yard, kind: "truck" },
        { assetId: rig, yardId: yard, kind: "rig" },
        { assetId: elsewhere, yardId: id(), kind: "truck" },
      ],
      reservations: [
        {
          assetIds: [rig],
          startAt: "2026-10-20T13:00:00Z",
          endAt: "2026-10-20T15:00:00Z",
        },
      ],
    });
    expect(ranked).toEqual([
      { assetId: truck, available: true, reasons: [] },
      { assetId: rig, available: false, reasons: ["reserved_in_window"] },
      { assetId: elsewhere, available: false, reasons: ["different_yard"] },
    ]);
  });

  it("inherits rig location from its attached truck until detach or transfer", async () => {
    const api = await import("./fleet-yard");
    const truck = id(),
      trailer = id(),
      yard = id();
    const result = api.resolveAttachedCustody(
      [
        {
          assetId: truck,
          yardId: yard,
          runId: null,
          state: "at_yard",
          latitude: 35,
          longitude: -97,
        },
        {
          assetId: trailer,
          yardId: null,
          runId: null,
          state: "attached",
          latitude: null,
          longitude: null,
        },
      ],
      [{ truckAssetId: truck, componentAssetId: trailer }],
    );
    expect(
      result.find((row: { assetId: string }) => row.assetId === trailer),
    ).toMatchObject({
      yardId: yard,
      latitude: 35,
      longitude: -97,
      inheritedFromAssetId: truck,
    });
    expect(
      api
        .resolveAttachedCustody(
          [
            result[0],
            {
              ...result[1],
              state: "transferred",
              yardId: null,
              latitude: null,
              longitude: null,
            },
          ],
          [],
        )
        .find((row: { assetId: string }) => row.assetId === trailer),
    ).toMatchObject({
      state: "transferred",
      yardId: null,
      inheritedFromAssetId: null,
    });
  });

  it("uses the actual attached Detail when a rig component appears in multiple reusable packages", async () => {
    const { resolveAttachedCustody } = await import("./fleet-yard");
    const firstTruck = id(),
      secondTruck = id(),
      component = id(),
      firstDetail = id(),
      secondDetail = id();
    const firstYard = id(),
      secondYard = id();
    const rows = [
      {
        assetId: firstTruck,
        detailId: null,
        yardId: firstYard,
        runId: null,
        state: "at_yard",
        latitude: null,
        longitude: null,
      },
      {
        assetId: secondTruck,
        detailId: null,
        yardId: secondYard,
        runId: null,
        state: "at_yard",
        latitude: null,
        longitude: null,
      },
      {
        assetId: component,
        detailId: secondDetail,
        yardId: null,
        runId: null,
        state: "attached",
        latitude: null,
        longitude: null,
      },
    ];
    const result = resolveAttachedCustody(rows, [
      {
        truckAssetId: secondTruck,
        componentAssetId: component,
        detailId: secondDetail,
      },
      {
        truckAssetId: firstTruck,
        componentAssetId: component,
        detailId: firstDetail,
      },
    ]);
    expect(result[2]).toMatchObject({
      yardId: secondYard,
      inheritedFromAssetId: secondTruck,
    });
  });

  it("rejects an attached-custody claim for an asset outside its selected Detail rig", async () => {
    const { isAssetInAttachedDetail } = await import("./fleet-yard");
    const truck = id(),
      trailer = id(),
      other = id(),
      detailId = id(),
      rigId = id();
    const detail = {
      id: detailId,
      vehicleAssetId: truck,
      rigPackageId: rigId,
      rigPackageVersion: 1,
    };
    const rig = { id: rigId, version: 1, components: [{ assetId: trailer }] };
    expect(isAssetInAttachedDetail(trailer, detailId, [detail], [rig])).toBe(
      true,
    );
    expect(isAssetInAttachedDetail(other, detailId, [detail], [rig])).toBe(
      false,
    );
    expect(isAssetInAttachedDetail(trailer, id(), [detail], [rig])).toBe(false);
  });

  it("allows a Driver app check-in only for an asset on that Driver's current Run", async () => {
    const { createFleetYardOperations } = await import("./fleet-yard");
    const fleetId = id(),
      truck = id(),
      other = id(),
      runId = id();
    const actor = {
      userId: 12,
      companyId: 7,
      role: "field_employee",
      membershipRole: "field_employee",
      activeMembershipId: 5,
      sv: 1,
      fleetCapabilities: new Set<"driver">(["driver"]),
    };
    const state = {
      ...emptyFleetState(),
      enabled: true,
      fleets: [
        {
          id: fleetId,
          name: "Fleet",
          siteIds: [],
          equipmentAssetIds: [truck, other],
          requiredCertifications: [],
        },
      ],
      grants: [
        {
          userId: 12,
          fleetIds: [fleetId],
          siteIds: [],
          roles: ["driver"],
          safetyRelease: false,
          financeRead: false,
        },
      ],
      runs: [
        {
          id: runId,
          driverUserId: 12,
          vehicleAssetId: truck,
          trailerAssetId: null,
        },
      ],
    };
    const writes: string[] = [];
    const client = {
      query: async (sql: string, args: any[] = []) => {
        if (sql.startsWith("INSERT")) writes.push(sql);
        if (sql.includes("FROM fleet_asset_custody_events"))
          return { rows: [] };
        if (sql.includes("FROM fleet_asset_custody WHERE")) return { rows: [] };
        if (sql.includes("FROM assets a"))
          return {
            rows: [
              {
                id: args[0][0],
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
        if (sql.includes("INSERT INTO fleet_asset_custody("))
          return {
            rows: [
              {
                id: args[0],
                company_id: 7,
                asset_id: args[2],
                state: args[3],
                method: args[4],
                observed_at: new Date(args[5]),
                observed_by_user_id: 12,
                yard_id: args[7],
                run_id: args[8],
                detail_id: args[9],
                latitude: args[10],
                longitude: args[11],
                notes: args[12],
                version: 1,
              },
            ],
          };
        return { rows: [] };
      },
    } as unknown as PoolClient;
    const repo = {
      transaction: async (_company: number, _user: number, work: any) =>
        work(state, client),
    } as any;
    const service = createFleetYardOperations(repo);
    const input = (assetId: string) => ({
      operationId: id(),
      expectedVersion: 0,
      scope: {
        owner: { type: "vendor", id: 7 },
        userId: 12,
        membershipId: 5,
        sessionVersion: 1,
      },
      observation: {
        companyId: 7,
        assetId,
        state: "at_yard",
        method: "driver_app",
        observedAt: "2026-10-19T12:00:00Z",
        observedByUserId: 12,
        yardId: null,
        runId,
        detailId: null,
        latitude: null,
        longitude: null,
        notes: "Self check-in",
      },
    });
    await expect(
      service.observeCustody(actor, input(other)),
    ).rejects.toMatchObject({ code: "fleet.permission_denied" });
    expect(writes).toHaveLength(0);
    const receipt = await service.observeCustody(actor, input(truck));
    expect(receipt).toMatchObject({
      version: 1,
      observation: { assetId: truck, method: "driver_app" },
    });
  });
});
