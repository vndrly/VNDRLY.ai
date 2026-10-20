import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { emptyFleetState } from "./fleet-repository";
import { createFleetYardOperations } from "./fleet-yard";

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
          fleetId,
          siteIds: [],
          driverUserId: 12,
          vehicleAssetId: truck,
          trailerAssetId: null,
          status: "in_progress",
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

describe("Yard and custody authorization regressions", () => {
  const scope = (userId = 12) => ({ owner: { type: "vendor" as const, id: 7 }, userId, membershipId: 5, sessionVersion: 1 });
  const actor = (caps: string[] = ["dispatch"]) => ({ userId: 12, companyId: 7, role: "field_employee", membershipRole: "field_employee", activeMembershipId: 5, sv: 1, fleetCapabilities: new Set(caps) }) as any;
  const fleetA = id(), fleetB = id(), truckA = id(), truckB = id(), dolly = id(), tank = id(), runId = id();
  const state = () => ({ ...emptyFleetState(), enabled: true,
    fleets: [{ id: fleetA, name: "A", siteIds: [], equipmentAssetIds: [truckA, dolly, tank], requiredCertifications: [] }, { id: fleetB, name: "B", siteIds: [], equipmentAssetIds: [truckB], requiredCertifications: [] }],
    grants: [{ userId: 12, fleetIds: [fleetA], siteIds: [], roles: ["dispatcher", "driver"], safetyRelease: false, financeRead: false }, { userId: 13, fleetIds: [fleetB], siteIds: [], roles: ["yard"], safetyRelease: false, financeRead: false }],
    runs: [] as any[],
  });
  const orderRow = (assetId: string, assignedToUserId: number | null = null) => ({ id: id(), company_id: 7, version: 1, yard_id: null, detail_id: null, run_id: null, status: assignedToUserId ? "assigned" : "requested", outcome: null, requested_by_user_id: 12, assigned_to_user_id: assignedToUserId, requested_at: new Date(), scheduled_at: null, started_at: null, reported_at: null, requested_asset_ids: [assetId], actual_asset_ids: [], findings: [], notes: "" });
  const service = (fixture: ReturnType<typeof state>, rows: any[] = [], seen: string[] = []) => createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
    seen.push(sql);
    if (sql.includes("FROM fleet_yard_orders")) return { rows: sql.includes("id=$2") ? rows.filter(r => r.id === args[1]) : rows };
    if (sql.includes("FROM fleet_yard_order_events")) return { rows: [] };
    if (sql.includes("FROM fleet_asset_custody_events")) return { rows: [] };
    if (sql.includes("FROM fleet_asset_custody WHERE")) return { rows: [] };
    if (sql.includes("FROM user_org_memberships")) return { rows: [{ id: 5 }] };
    if (sql.includes("FROM fleet_person_capabilities")) return { rows: [{ capabilities: ["yard"] }] };
    if (sql.includes("FROM assets a")) return { rows: (args[0] as string[]).map(assetId => ({ id: assetId, name: assetId, category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true })) };
    if (sql.includes("FROM site_locations s JOIN partner_vendor_relationships")) return { rows: (args[1] as number[] ?? []).map(siteId => ({ id: siteId, is_active: true, partner_id: 99, relationship_id: 1, relationship_status: "approved", approval_events: [] })) };
    if (sql.includes("INSERT INTO fleet_asset_custody(")) return { rows: [{ id: args[0], company_id: 7, asset_id: args[2], state: args[3], method: args[4], observed_at: new Date(args[5]), observed_by_user_id: 12, yard_id: args[7], run_id: args[8], detail_id: args[9], latitude: args[10], longitude: args[11], notes: args[12], version: 1 }] };
    if (sql.includes("UPDATE fleet_yard_orders SET")) return { rows: [{ ...rows[0], status: args[2], outcome: args[3], assigned_to_user_id: args[4], started_at: args[5] ? new Date(args[5]) : null, reported_at: args[6] ? new Date(args[6]) : null, actual_asset_ids: args[7], findings: JSON.parse(args[8]), notes: args[9], version: args[10] }] };
    if (sql.includes("INSERT INTO fleet_yard_orders(")) return { rows: [{ id: args[0], company_id: 7, yard_id: args[2], detail_id: args[3], run_id: args[4], status: args[5], outcome: args[6], requested_by_user_id: args[7], assigned_to_user_id: args[8], requested_at: new Date(args[9]), scheduled_at: null, started_at: null, reported_at: null, requested_asset_ids: args[13], actual_asset_ids: args[14], findings: JSON.parse(args[15]), notes: args[16], version: args[17] }] };
    if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [], rigPackages: [], reservations: [] } }] };
    return { rows: [] };
  } } as unknown as PoolClient) } as any);
  const custodyInput = (assetId: string, run: string, expectedVersion = 0) => ({ operationId: id(), expectedVersion, scope: scope(), observation: { companyId: 7, assetId, state: "at_yard", method: "driver_app", observedAt: "2026-10-19T12:00:00Z", observedByUserId: 12, yardId: null, runId: run, detailId: null, latitude: null, longitude: null, notes: "" } });

  it("hides and rejects another Fleet's Yard Order, including requested target on create", async () => {
    const row = orderRow(truckB);
    const api = service(state(), [row]);
    expect((await api.yardOrders(actor())).orders).toEqual([]);
    await expect(api.yardOrder(actor(), row.id)).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId: null, runId: null, status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null, requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [truckB], actualAssetIds: [], findings: [], notes: "" };
    await expect(api.createYardOrder(actor(), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).rejects.toMatchObject({ code: "fleet.asset_not_found" });
  });

  it("rejects stale completed and superseded Driver Runs, but includes every assigned rig component", async () => {
    const fixture = state();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "completed", resourceAssignment: { reservation: { state: "released" }, snapshot: { detail: { vehicleAssetId: truckA }, rigPackage: { components: [{ assetId: dolly }, { assetId: tank }] } } } }];
    const api = service(fixture);
    await expect(api.observeCustody(actor(["driver"]), custodyInput(dolly, runId))).rejects.toMatchObject({ code: "fleet.permission_denied" });
    fixture.runs[0].status = "in_progress";
    fixture.runs[0].resourceAssignment.reservation.state = "active";
    await expect(api.observeCustody(actor(["driver"]), custodyInput(dolly, runId))).resolves.toMatchObject({ observation: { assetId: dolly } });
    await expect(api.observeCustody(actor(["driver"]), custodyInput(tank, runId))).resolves.toMatchObject({ observation: { assetId: tank } });
    fixture.runs.push({ id: id(), driverUserId: 13, vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress", resourceAssignment: { reservation: { state: "active" }, snapshot: { detail: { vehicleAssetId: truckA }, rigPackage: { components: [{ assetId: dolly }] } } } });
    await expect(api.observeCustody(actor(["driver"]), custodyInput(dolly, runId))).rejects.toMatchObject({ code: "fleet.permission_denied" });
  });

  it("does not infer attached location from a mutable Detail without an immutable attachment event", async () => {
    const fixture = state();
    const attached = { id: id(), company_id: 7, asset_id: dolly, state: "attached", method: "manual", observed_at: new Date(), observed_by_user_id: 12, yard_id: null, run_id: null, detail_id: id(), latitude: null, longitude: null, notes: "", version: 1 };
    const yard = id();
    const truck = { ...attached, id: id(), asset_id: truckB, state: "at_yard", detail_id: null, yard_id: yard };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM fleet_asset_custody c")) return { rows: [attached, truck] };
      if (sql.includes("FROM fleet_asset_custody_events")) return { rows: [] };
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [{ id: attached.detail_id, companyId: 7, version: 2, name: "Changed", vehicleAssetId: truckB, rigPackageId: id(), rigPackageVersion: 2, driverUserId: null, accessGroupIds: [fleetA], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }], rigPackages: [], reservations: [] } }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    expect((await api.custody(actor(["yard"]))).custody.find((r: any) => r.observation.assetId === dolly)?.location.inheritedFromAssetId).toBeNull();
  });

  it("uses the attachment event's truck after the Detail is revised or archived", async () => {
    const fixture = state(), detailId = id(), yard = id();
    const attached = { id: id(), company_id: 7, asset_id: dolly, state: "attached", method: "manual", observed_at: new Date(), observed_by_user_id: 12, yard_id: null, run_id: null, detail_id: detailId, latitude: null, longitude: null, notes: "", version: 2 };
    const truck = { ...attached, id: id(), asset_id: truckA, state: "at_yard", detail_id: null, yard_id: yard };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM fleet_asset_custody c")) return { rows: [attached, truck] };
      if (sql.includes("FROM fleet_asset_custody_events e JOIN")) return { rows: [{ asset_id: dolly, asset_version: 2, tool_output: { attachment: { truckAssetId: truckA, componentAssetId: dolly, detailId, detailVersion: 1, rigPackageId: id(), rigPackageVersion: 1 } } }] };
      if (sql.includes("FROM vendors WHERE")) throw new Error("Current Detail must not be consulted");
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    expect((await api.custody(actor(["yard"]))).custody.find((r: any) => r.observation.assetId === dolly)?.location).toMatchObject({ yardId: yard, inheritedFromAssetId: truckA });
  });

  it("lets self-dispatch act on its own Run's Yard Order but not another Fleet's or an unassigned order", async () => {
    const fixture = state();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress" }];
    const row = { ...orderRow(truckA, 12), run_id: runId };
    const api = service(fixture, [row]);
    const action = { kind: "start", operationId: id(), expectedVersion: 1, scope: scope(), orderId: row.id };
    await expect(api.actOnYardOrder(actor(["driver", "self_dispatch"]), row.id, action)).resolves.toMatchObject({ status: "in_progress", version: 2 });
    await expect(api.actOnYardOrder(actor(["driver"]), row.id, { ...action, operationId: id() })).rejects.toMatchObject({ code: "fleet.permission_denied" });
    const other = { ...row, id: id(), requested_asset_ids: [truckB] };
    await expect(service(fixture, [other]).actOnYardOrder(actor(["driver", "self_dispatch"]), other.id, { ...action, orderId: other.id, operationId: id() })).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
    const unassigned = { ...row, id: id(), assigned_to_user_id: 13 };
    await expect(service(fixture, [unassigned]).actOnYardOrder(actor(["driver", "self_dispatch"]), unassigned.id, { ...action, orderId: unassigned.id, operationId: id() })).rejects.toMatchObject({ code: "fleet.permission_denied" });
  });

  it("lets self-dispatch create a Yard Order only for its own active Run", async () => {
    const fixture = state();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress" }];
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId: null, runId, status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null, requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    await expect(service(fixture).createYardOrder(actor(["driver", "self_dispatch"]), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).resolves.toMatchObject({ runId, requestedAssetIds: [truckA] });
    await expect(service(fixture).createYardOrder(actor(["driver"]), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).rejects.toMatchObject({ code: "fleet.permission_denied" });
    const requested = { ...orderRow(truckA), run_id: runId };
    await expect(service(fixture, [requested]).actOnYardOrder(actor(["driver", "self_dispatch"]), requested.id,
      { kind: "assign", operationId: id(), expectedVersion: 1, scope: scope(), orderId: requested.id, assignedToUserId: 12 })).resolves.toMatchObject({ status: "assigned", assignedToUserId: 12 });
  });

  it("rechecks current Driver assignment and Inventory holder before custody replay", async () => {
    const fixture = state();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "completed" }];
    const input = custodyInput(truckA, runId);
    let holder: number | null = null;
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM assets a")) return { rows: [{ id: truckA, name: "Truck", category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: holder, retired_at: null, merged_into_id: null, provisional: false, enrolled: true }] };
      if (sql.includes("FROM fleet_asset_custody_events")) return { rows: [{ id: id() }] };
      if (sql.includes("FROM assistant_action_audit")) return { rows: [{ user_id: 12, tool_input: { fingerprint: "mismatch" }, tool_output: { operationId: input.operationId } }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.observeCustody(actor(["driver"]), input)).rejects.toMatchObject({ code: "fleet.permission_denied" });
    fixture.runs[0].status = "in_progress";
    holder = 13;
    await expect(api.observeCustody(actor(["driver"]), input)).rejects.toMatchObject({ code: "fleet.permission_denied" });
    holder = null;
    await expect(api.observeCustody(actor(["driver"]), input)).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  });

  it("limits Driver custody reads to active assigned components still in their custody", async () => {
    const fixture = state();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress", resourceAssignment: { reservation: { state: "active" }, snapshot: { detail: { vehicleAssetId: truckA }, rigPackage: { components: [{ assetId: dolly }, { assetId: tank }] } } } }];
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("SELECT id,current_holder_user_id FROM assets")) return { rows: [{ id: truckA, current_holder_user_id: 13 }, { id: dolly, current_holder_user_id: null }, { id: tank, current_holder_user_id: 12 }] };
      if (sql.includes("FROM fleet_asset_custody c")) return { rows: (args[1] as string[]).map(assetId => ({ id: id(), company_id: 7, asset_id: assetId, state: "in_transit", method: "driver_app", observed_at: new Date(), observed_by_user_id: 12, yard_id: null, run_id: runId, detail_id: null, latitude: null, longitude: null, notes: "", version: 1 })) };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    expect((await api.custody(actor(["driver"]))).custody.map((row: any) => row.observation.assetId).sort()).toEqual([dolly, tank].sort());
  });

  it("reads an owned Yard operation receipt only while its current order remains in scope", async () => {
    const fixture = state(), operationId = id(), row = orderRow(truckA);
    const receipt = { id: row.id, companyId: 7, version: 1, yardId: null, detailId: null, runId: null,
      status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null,
      requestedAt: row.requested_at.toISOString(), scheduledAt: null, startedAt: null, reportedAt: null,
      requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM assistant_action_audit")) return { rows: [{ user_id: 12, target_type: "fleet-yard-order-operation", tool_output: receipt }] };
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [row] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.yardOperationReceipt(actor(), operationId)).resolves.toMatchObject({ operationId, result: { id: row.id } });
    row.requested_asset_ids = [truckB];
    await expect(api.yardOperationReceipt(actor(), operationId)).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
  });

  it("requires the current Run to read a historical Driver custody receipt", async () => {
    const fixture = state(), operationId = id();
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "completed" }];
    const observation = { id: id(), companyId: 7, assetId: truckA, state: "returned", method: "driver_app", observedAt: "2026-10-19T12:00:00Z", observedByUserId: 12, yardId: null, runId, detailId: null, latitude: null, longitude: null, notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM assistant_action_audit")) return { rows: [{ user_id: 12, tool_output: { operationId, version: 1, observation } }] };
      if (sql.includes("FROM assets a")) return { rows: [{ id: truckA, name: "Truck", category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.custodyOperationReceipt(actor(["driver"]), operationId)).rejects.toMatchObject({ code: "fleet.permission_denied" });
    fixture.runs[0].status = "in_progress";
    await expect(api.custodyOperationReceipt(actor(["driver"]), operationId)).resolves.toMatchObject({ operationId, result: { observation: { assetId: truckA } } });
  });

  it("rejects assigning an authorized Yard Order to a Yard worker in a different Fleet", async () => {
    const fixture = state(), row = orderRow(truckA);
    const api = service(fixture, [row]);
    await expect(api.actOnYardOrder(actor(), row.id, { kind: "assign", operationId: id(), expectedVersion: 1, scope: scope(), orderId: row.id, assignedToUserId: 13 })).rejects.toMatchObject({ code: "fleet.permission_denied" });
  });

  it("accepts assigned Driver custody with no personal site grant, then hides it after company site revocation", async () => {
    const fixture = state(), siteId = 100;
    fixture.fleets[0].siteIds = [siteId];
    fixture.grants[0].roles = ["driver"];
    fixture.runs = [{ id: runId, fleetId: fleetA, companyId: 7, siteIds: [siteId], driverUserId: 12,
      vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress",
      resourceAssignment: { reservation: { state: "active" }, snapshot: { detail: { vehicleAssetId: truckA }, rigPackage: { components: [{ assetId: dolly }] } } } }];
    let approved = true, saved: any = null, event = false, receipt: any = null, receiptInput: any = null;
    const input = { ...custodyInput(dolly, runId), observation: { ...custodyInput(dolly, runId).observation, state: "returned" } };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM site_locations s JOIN partner_vendor_relationships")) return { rows: approved ? [{ id: siteId, is_active: true, partner_id: 99, relationship_id: 1, relationship_status: "approved", approval_events: [] }] : [] };
      if (sql.includes("FROM assets a")) return { rows: (args[0] as string[]).map(assetId => ({ id: assetId, name: "Asset", category: "dolly", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true })) };
      if (sql.includes("SELECT id,current_holder_user_id FROM assets")) return { rows: [truckA, dolly].map(assetId => ({ id: assetId, current_holder_user_id: null })) };
      if (sql.includes("FROM fleet_asset_custody_events")) return { rows: event ? [{ id: id() }] : [] };
      if (sql.includes("FROM fleet_asset_custody c")) return { rows: saved && (args[1] as string[]).includes(saved.asset_id) ? [saved] : [] };
      if (sql.includes("FROM fleet_asset_custody WHERE")) return { rows: saved ? [saved] : [] };
      if (sql.includes("INSERT INTO fleet_asset_custody(")) { saved = { id: args[0], company_id: 7, asset_id: args[2], state: args[3], method: args[4], observed_at: new Date(args[5]), observed_by_user_id: 12, yard_id: args[7], run_id: args[8], detail_id: args[9], latitude: args[10], longitude: args[11], notes: args[12], version: 1 }; return { rows: [saved] }; }
      if (sql.includes("INSERT INTO fleet_asset_custody_events")) { event = true; return { rows: [] }; }
      if (sql.includes("INSERT INTO assistant_action_audit")) { receiptInput = JSON.parse(args[5]); receipt = JSON.parse(args[6]); return { rows: [] }; }
      if (sql.includes("FROM assistant_action_audit")) return { rows: receipt ? [{ user_id: 12, tool_input: receiptInput, tool_output: receipt }] : [] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    const driver = actor(["driver"]);
    await expect(api.observeCustody(driver, input)).resolves.toMatchObject({ observation: { assetId: dolly, state: "returned" } });
    expect((await api.custody(driver)).custody.map((row: any) => row.observation.assetId)).toContain(dolly);
    await expect(api.custodyOperationReceipt(driver, input.operationId)).resolves.toMatchObject({ result: { observation: { assetId: dolly } } });
    await expect(api.observeCustody(driver, input)).resolves.toMatchObject({ operationId: input.operationId, version: 1 });
    approved = false;
    expect((await api.custody(driver)).custody).toEqual([]);
    await expect(api.custodyOperationReceipt(driver, input.operationId)).rejects.toMatchObject({ code: "fleet.permission_denied" });
    await expect(api.observeCustody(driver, input)).rejects.toMatchObject({ code: "fleet.permission_denied" });
  });

  it("rejects a Driver attaching its dolly to a foreign Detail and truck", async () => {
    const fixture = state(), ownDetailId = id(), foreignDetailId = id(), rigId = id();
    fixture.fleets[1].equipmentAssetIds.push(dolly);
    fixture.runs = [{ id: runId, fleetId: fleetA, siteIds: [], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress",
      resourceAssignment: { reservation: { state: "active" }, snapshot: { detail: { id: ownDetailId, vehicleAssetId: truckA }, rigPackage: { components: [{ assetId: dolly }] } } } }];
    const registry = { version: 1, details: [{ id: foreignDetailId, companyId: 7, version: 1, name: "Foreign", vehicleAssetId: truckB, rigPackageId: rigId, rigPackageVersion: 1, driverUserId: null, accessGroupIds: [fleetB], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }],
      rigPackages: [{ id: rigId, companyId: 7, version: 1, name: "Dolly", components: [{ assetId: dolly, role: "dolly", sequence: 0 }], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }], reservations: [] };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM assets a")) return { rows: (args[0] as string[]).map(assetId => ({ id: assetId, name: "Asset", category: "dolly", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true })) };
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: registry }] };
      if (sql.includes("INSERT INTO fleet_asset_custody(")) return { rows: [{ id: args[0], company_id: 7, asset_id: args[2], state: args[3], method: args[4], observed_at: new Date(args[5]), observed_by_user_id: 12, yard_id: args[7], run_id: args[8], detail_id: args[9], latitude: args[10], longitude: args[11], notes: args[12], version: 1 }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.observeCustody(actor(["driver"]), { ...custodyInput(dolly, runId), observation: { ...custodyInput(dolly, runId).observation, state: "attached", detailId: foreignDetailId } })).rejects.toMatchObject({ code: "fleet.detail_attachment_required" });
  });

  it("rejects a shared-asset Detail restricted to another Fleet", async () => {
    const fixture = state(), detailId = id();
    fixture.fleets[1].equipmentAssetIds.push(truckA);
    const detail = { id: detailId, companyId: 7, version: 1, name: "B-only", vehicleAssetId: truckA, rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [fleetB], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null };
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId, runId: null, status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null, requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [detail], rigPackages: [], reservations: [] } }] };
      if (sql.includes("FROM assets a")) return { rows: [{ id: truckA, name: "Truck", category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true }] };
      if (sql.includes("INSERT INTO fleet_yard_orders(")) return { rows: [{ id: value.id, company_id: 7, version: 1, yard_id: null, detail_id: detailId, run_id: null, status: "requested", outcome: null, requested_by_user_id: 12, assigned_to_user_id: null, requested_at: new Date(value.requestedAt), scheduled_at: null, started_at: null, reported_at: null, requested_asset_ids: [truckA], actual_asset_ids: [], findings: [], notes: "" }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.createYardOrder(actor(), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).rejects.toMatchObject({ code: "fleet.detail_not_found" });
  });

  it("lets Self-Dispatch prepare an own draft Run before dispatch without changing Run status", async () => {
    const fixture = state(), siteId = 100;
    fixture.fleets[0].siteIds = [siteId];
    fixture.runs = [{ id: runId, fleetId: fleetA, companyId: 7, siteIds: [siteId], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "draft" }];
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId: null, runId, status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null, requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const self = actor(["driver", "self_dispatch"]);
    await expect(service(fixture).createYardOrder(self, { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).resolves.toMatchObject({ runId, status: "requested" });
    const requested = { ...orderRow(truckA), run_id: runId };
    await expect(service(fixture, [requested]).actOnYardOrder(self, requested.id, { kind: "assign", operationId: id(), expectedVersion: 1, scope: scope(), orderId: requested.id, assignedToUserId: 12 })).resolves.toMatchObject({ status: "assigned" });
    const assigned = { ...requested, status: "assigned", assigned_to_user_id: 12 };
    await expect(service(fixture, [assigned]).actOnYardOrder(self, assigned.id, { kind: "start", operationId: id(), expectedVersion: 1, scope: scope(), orderId: assigned.id })).resolves.toMatchObject({ status: "in_progress" });
    const started = { ...assigned, version: 2, status: "in_progress", started_at: new Date() };
    await expect(service(fixture, [started]).actOnYardOrder(self, started.id, { kind: "report", operationId: id(), expectedVersion: 2, scope: scope(), orderId: started.id, outcome: "ready", notes: "Prepared" })).resolves.toMatchObject({ status: "reported", outcome: "ready" });
    expect(fixture.runs[0].status).toBe("draft");
  });

  it("keeps captured Detail ACL on order list, detail, action, and receipt after shared equipment overlaps", async () => {
    const fixture = state(), detailId = id(), operationId = id();
    fixture.fleets[1].equipmentAssetIds.push(truckA);
    const row = { ...orderRow(truckA, 12), detail_id: detailId };
    const receipt = { id: row.id, companyId: 7, version: 1, yardId: null, detailId, runId: null,
      status: "assigned", outcome: null, requestedByUserId: 12, assignedToUserId: 12,
      requestedAt: row.requested_at.toISOString(), scheduledAt: null, startedAt: null, reportedAt: null,
      requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [row] };
      if (sql.includes("FROM fleet_yard_order_events") && sql.includes("event_type='requested'")) return { rows: [{ detail: { detailAccessGroupIds: [fleetB] } }] };
      if (sql.includes("FROM assistant_action_audit")) return { rows: [{ user_id: 12, target_type: "fleet-yard-order-operation", tool_output: receipt }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    expect((await api.yardOrders(actor())).orders).toEqual([]);
    await expect(api.yardOrder(actor(), row.id)).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
    await expect(api.actOnYardOrder(actor(), row.id, { kind: "start", operationId: id(), expectedVersion: 1, scope: scope(), orderId: row.id })).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
    await expect(api.yardOperationReceipt(actor(), operationId)).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
  });

  it("does not promote a legacy order with no captured Detail ACL from a mutable current template", async () => {
    const fixture = state(), detailId = id(), row = { ...orderRow(truckA), detail_id: detailId };
    const detail = { id: detailId, companyId: 7, version: 2, name: "Edited", vehicleAssetId: truckA, rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [fleetA], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string) => {
      if (sql.includes("FROM fleet_yard_orders")) return { rows: [row] };
      if (sql.includes("FROM fleet_yard_order_events")) return { rows: [{ detail: { fingerprint: "old" } }] };
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [detail], rigPackages: [], reservations: [] } }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    expect((await api.yardOrders(actor())).orders).toEqual([]);
    await expect(api.yardOrder(actor(), row.id)).rejects.toMatchObject({ code: "fleet.yard_order_not_found" });
  });

  it("rejects a Yard attachment when its target truck is held by an unrelated person", async () => {
    const fixture = state(), detailId = id(), rigId = id();
    const registry = { version: 1, details: [{ id: detailId, companyId: 7, version: 1, name: "Own Detail", vehicleAssetId: truckA, rigPackageId: rigId, rigPackageVersion: 1, driverUserId: null, accessGroupIds: [fleetA], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }],
      rigPackages: [{ id: rigId, companyId: 7, version: 1, name: "Dolly", components: [{ assetId: dolly, role: "dolly", sequence: 0 }], effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null }], reservations: [] };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: registry }] };
      if (sql.includes("FROM assets a")) return { rows: (args[0] as string[]).map(assetId => ({ id: assetId, name: "Asset", category: assetId === truckA ? "truck" : "dolly", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: assetId === truckA ? 99 : null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true })) };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    const input = custodyInput(dolly, runId);
    await expect(api.observeCustody(actor(["yard"]), { ...input, observation: { ...input.observation, method: "manual", runId: null, state: "attached", detailId } })).rejects.toMatchObject({ code: "fleet.detail_attachment_required" });
  });

  it("denies draft Self-Dispatch Yard preparation after the company loses the Run site", async () => {
    const fixture = state(), siteId = 100;
    fixture.fleets[0].siteIds = [siteId];
    fixture.runs = [{ id: runId, fleetId: fleetA, companyId: 7, siteIds: [siteId], driverUserId: 12, vehicleAssetId: truckA, trailerAssetId: null, status: "draft" }];
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId: null, runId, status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null, requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null, requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async () => ({ rows: [] }) } as unknown as PoolClient) } as any);
    await expect(api.createYardOrder(actor(["driver", "self_dispatch"]), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).rejects.toMatchObject({ code: "fleet.permission_denied" });
  });

  it("creates and canonically reads back an authorized Detail-backed Yard Order", async () => {
    const fixture = state(), detailId = id(), operationId = id();
    const detail = { id: detailId, companyId: 7, version: 1, name: "A truck", vehicleAssetId: truckA,
      rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [fleetA],
      effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null };
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId, runId: null,
      status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null,
      requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null,
      requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    let row: any = null, event: any = null, audit: any = null;
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [detail], rigPackages: [], reservations: [] } }] };
      if (sql.includes("FROM assets a")) return { rows: [{ id: truckA, name: "Truck", category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true }] };
      if (sql.includes("SELECT actor_user_id,detail FROM fleet_yard_order_events")) return { rows: event ? [{ actor_user_id: 12, detail: event }] : [] };
      if (sql.includes("SELECT detail FROM fleet_yard_order_events")) return { rows: event ? [{ detail: event }] : [] };
      if (sql.includes("INSERT INTO fleet_yard_orders(")) { row = { id: value.id, company_id: 7, version: 1, yard_id: null, detail_id: detailId, run_id: null, status: "requested", outcome: null, requested_by_user_id: 12, assigned_to_user_id: null, requested_at: new Date(value.requestedAt), scheduled_at: null, started_at: null, reported_at: null, requested_asset_ids: [truckA], actual_asset_ids: [], findings: [], notes: "" }; return { rows: [row] }; }
      if (sql.includes("FROM fleet_yard_orders")) return { rows: row ? [row] : [] };
      if (sql.includes("INSERT INTO fleet_yard_order_events")) { event = JSON.parse(args[4]); return { rows: [] }; }
      if (sql.includes("INSERT INTO assistant_action_audit")) { audit = { user_id: 12, target_type: "fleet-yard-order-operation", tool_input: JSON.parse(args[5]), tool_output: JSON.parse(args[6]) }; return { rows: [] }; }
      if (sql.includes("FROM assistant_action_audit")) return { rows: audit ? [audit] : [] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    const input = { operationId, expectedVersion: 0, scope: scope(), order: value };
    await expect(api.createYardOrder(actor(), input)).resolves.toMatchObject({ id: value.id, detailId });
    await expect(api.createYardOrder(actor(), input)).resolves.toMatchObject({ id: value.id, detailId });
    await expect(api.yardOrder(actor(), value.id)).resolves.toMatchObject({ order: { id: value.id, detailId } });
    await expect(api.yardOperationReceipt(actor(), operationId)).resolves.toMatchObject({ result: { id: value.id, detailId } });
  });

  it("permits own draft Self-Dispatch preparation with a reusable Detail", async () => {
    const fixture = state(), detailId = id();
    fixture.runs = [{ id: runId, fleetId: fleetA, companyId: 7, siteIds: [], driverUserId: 12,
      vehicleAssetId: truckA, trailerAssetId: null, status: "draft" }];
    const detail = { id: detailId, companyId: 7, version: 1, name: "Reusable", vehicleAssetId: truckA,
      rigPackageId: null, rigPackageVersion: null, driverUserId: null, accessGroupIds: [fleetA],
      effectiveFrom: "2026-10-19T00:00:00Z", effectiveUntil: null, archivedAt: null };
    const value = { id: id(), companyId: 7, version: 1, yardId: null, detailId, runId,
      status: "requested", outcome: null, requestedByUserId: 12, assignedToUserId: null,
      requestedAt: "2026-10-19T12:00:00Z", scheduledAt: null, startedAt: null, reportedAt: null,
      requestedAssetIds: [truckA], actualAssetIds: [], findings: [], notes: "" };
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [detail], rigPackages: [], reservations: [] } }] };
      if (sql.includes("FROM assets a")) return { rows: [{ id: truckA, name: "Truck", category: "truck", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true }] };
      if (sql.includes("INSERT INTO fleet_yard_orders(")) return { rows: [{ id: value.id, company_id: 7, version: 1, yard_id: null, detail_id: detailId, run_id: runId, status: "requested", outcome: null, requested_by_user_id: 12, assigned_to_user_id: null, requested_at: new Date(value.requestedAt), scheduled_at: null, started_at: null, reported_at: null, requested_asset_ids: [truckA], actual_asset_ids: [], findings: [], notes: "" }] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    await expect(api.createYardOrder(actor(["driver", "self_dispatch"]), { operationId: id(), expectedVersion: 0, scope: scope(), order: value })).resolves.toMatchObject({ runId, detailId });
    expect(fixture.runs[0].status).toBe("draft");
  });

  it("rechecks a retained attachment's truck on replay and receipt read, then allows recovery when restored", async () => {
    const fixture = state(), detailId = id(), rigId = id();
    fixture.grants[0].roles = ["driver"];
    fixture.runs = [{ id: runId, fleetId: fleetA, companyId: 7, siteIds: [], driverUserId: 12,
      vehicleAssetId: truckA, trailerAssetId: null, status: "in_progress",
      resourceAssignment: { reservation: { state: "active" }, snapshot: {
        detail: { id: detailId, version: 1, vehicleAssetId: truckA, accessGroupIds: [fleetA] },
        rigPackage: { id: rigId, version: 1, components: [{ assetId: dolly }] },
      } } }];
    let holder: number | null = null, saved: any = null, event = false, audit: any = null;
    const api = createFleetYardOperations({ transaction: async (_c: number, _u: number, work: any) => work(fixture, { query: async (sql: string, args: any[] = []) => {
      if (sql.includes("FROM vendors WHERE")) return { rows: [{ fleet_resources: { version: 1, details: [], rigPackages: [], reservations: [] } }] };
      if (sql.includes("FROM assets a")) return { rows: (args[0] as string[]).map(assetId => ({ id: assetId, name: "Asset", category: assetId === truckA ? "truck" : "dolly", status: "available", responsible_org_type: "vendor", responsible_org_id: 7, current_holder_user_id: assetId === truckA ? holder : null, retired_at: null, merged_into_id: null, provisional: false, enrolled: true })) };
      if (sql.includes("FROM fleet_asset_custody_events")) return { rows: event ? [{ id: id() }] : [] };
      if (sql.includes("FROM fleet_asset_custody WHERE")) return { rows: args[1] === dolly && saved ? [saved] : [] };
      if (sql.includes("INSERT INTO fleet_asset_custody(")) { saved = { id: args[0], company_id: 7, asset_id: args[2], state: args[3], method: args[4], observed_at: new Date(args[5]), observed_by_user_id: 12, yard_id: args[7], run_id: args[8], detail_id: args[9], latitude: args[10], longitude: args[11], notes: args[12], version: 1 }; return { rows: [saved] }; }
      if (sql.includes("INSERT INTO fleet_asset_custody_events")) { event = true; return { rows: [] }; }
      if (sql.includes("INSERT INTO assistant_action_audit")) { audit = { user_id: 12, tool_input: JSON.parse(args[5]), tool_output: JSON.parse(args[6]) }; return { rows: [] }; }
      if (sql.includes("FROM assistant_action_audit")) return { rows: audit ? [audit] : [] };
      return { rows: [] };
    } } as unknown as PoolClient) } as any);
    const base = custodyInput(dolly, runId);
    const input = { ...base, observation: { ...base.observation, state: "attached", detailId } };
    const driver = actor(["driver"]);
    const created = await api.observeCustody(driver, input);
    expect(created).toMatchObject({ attachment: { truckAssetId: truckA, detailId, detailVersion: 1, rigPackageVersion: 1 } });
    holder = 99;
    await expect(api.observeCustody(driver, input)).rejects.toMatchObject({ code: "fleet.detail_attachment_required" });
    await expect(api.custodyOperationReceipt(driver, input.operationId)).rejects.toMatchObject({ code: "fleet.detail_attachment_required" });
    holder = null;
    await expect(api.observeCustody(driver, input)).resolves.toEqual(created);
    await expect(api.custodyOperationReceipt(driver, input.operationId)).resolves.toMatchObject({ result: { attachment: { truckAssetId: truckA } } });
  });
});
