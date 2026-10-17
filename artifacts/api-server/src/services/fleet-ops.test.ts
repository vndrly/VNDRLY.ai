import { describe, expect, it, vi, beforeEach } from "vitest";
const notifications = vi.hoisted(() => vi.fn());
vi.mock("../routes/notifications", () => ({ notifyUsers: notifications }));
beforeEach(() => {
  notifications.mockReset().mockResolvedValue(1);
});
import {
  previewFleetRunActions,
  FleetActionInputSchema,
  FleetRunSchema,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { createFleetService } from "./fleet-ops";
import {
  emptyFleetState,
  type FleetRepository,
  type FleetState,
} from "./fleet-repository";
const fleetId = "11111111-1111-4111-8111-111111111111",
  vehicle = "22222222-2222-4222-8222-222222222222";
const manager = { userId: 1, companyId: 7 },
  driver = { userId: 2, companyId: 7 },
  stranger = { userId: 3, companyId: 7 };
function fixture() {
  let state: FleetState = {
    ...emptyFleetState(),
    enabled: true,
    fleets: [
      {
        id: fleetId,
        name: "Synthetic fleet",
        requiredCertifications: [],
        equipmentAssetIds: [vehicle],
        siteIds: [9],
      },
    ],
    grants: [
      {
        userId: 1,
        fleetIds: [fleetId],
        siteIds: [9],
        roles: ["fleet_manager"],
        safetyRelease: false,
        financeRead: false,
      },
      {
        userId: 2,
        fleetIds: [fleetId],
        siteIds: [9],
        roles: ["driver"],
        safetyRelease: false,
        financeRead: false,
      },
    ],
  };
  let required = false;
  let hold = false;
  let sitesVisible = true;
  let certificationRows: Array<{
    name: string;
    vendor_verified_at: string | null;
    expiration_date: string | null;
  }> = [];
  const billingTickets: {
    id: number;
    work_type_id: number;
    site_location_id: number;
    vendor_id: number;
    partner_id: number;
    status: string;
    fleet_plan: unknown;
  }[] = [];
  let availability: {
    starts_at: string;
    ends_at: string;
    available: boolean;
    recurrence: null;
  }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT fleet_resources FROM vendors")) return {rows:[{fleet_resources:null}]};
      if (sql.includes("FROM employee_certifications"))
        return { rows: certificationRows };
      if (sql.includes("FROM vendor_work_types"))
        return {
          rows: [
            {
              id: 3,
              name: "Synthetic haul",
              unit_price: "1.00",
              unit: "per_job",
              afe_number: "A1",
            },
          ],
        };
      if (sql.startsWith("INSERT INTO tickets")) {
        const ticket = {
          id: billingTickets.length + 10,
          work_type_id: 3,
          site_location_id: 9,
          vendor_id: 7,
          partner_id: 8,
          status: "initiated",
          fleet_plan: JSON.parse(params[5] as string),
        };
        billingTickets.push(ticket);
        return { rows: [ticket] };
      }
      if (sql.includes("FROM tickets"))
        return { rows: billingTickets.filter((t) => t.id === params[0]) };
      if (sql.startsWith("INSERT INTO ticket_line_items"))
        return { rows: [{ id: 100 }] };
      if (sql.includes("SELECT m.id FROM user_org_memberships"))
        return { rows: [{ id: 7 }] };
      if (sql.includes("FROM work_hub_form_instances"))
        return {
          rows: required
            ? [
                {
                  id: "10000000-0000-4000-8000-000000000003",
                  title: "Orientation",
                  template_version: 1,
                  assignment_metadata: {
                    assignmentId: "10000000-0000-4000-8000-000000000001",
                    sourceItemId: "10000000-0000-4000-8000-000000000002",
                    contentVersion: 1,
                    membershipId: 7,
                    requiredBeforeWork: true,
                    assignedAt: "2026-10-14T00:00:00Z",
                    dueAt: "2026-11-14T00:00:00Z",
                  },
                },
              ]
            : [],
        };
      if (sql.includes("FROM work_hub_availability"))
        return { rows: availability };
      if (sql.includes("m.user_id=ANY"))
        return { rows: [{ user_id: 1 }, { user_id: 2 }] };
      if (sql.startsWith("INSERT INTO asset_holds")) hold = true;
      return {
        rows: sql.includes("vendor_people")
          ? [{ id: 2 }]
          : sql.includes("FROM assets")
            ? [
                {
                  id: vehicle,
                  enrolled: true,
                  status: "available",
                  category: "truck",
                  current_holder_user_id: null,
                },
              ]
            : sql.includes("asset_holds")
              ? hold
                ? [{ id: 1 }]
                : []
              : sql.includes("site_locations")
                ? sitesVisible
                  ? [
                      {
                        id: 9,
                        relationship_id: 1,
                        relationship_status: "approved",
                        partner_id: 8,
                        afe: "A1",
                        status: "active",
                        is_active: true,
                      },
                    ]
                  : []
                : [],
      };
    },
  } as unknown as PoolClient;
  const repo: FleetRepository = {
    async transaction(companyId, userId, operation) {
      if (companyId !== 7) throw new Error("foreign company");
      const next = structuredClone(state);
      const result = await operation(next, client);
      state = next;
      return result;
    },
  };
  return {
    service: createFleetService(repo),
    state: () => state,
    certificates: (rows: typeof certificationRows) => {
      certificationRows = rows;
    },
    requireTraining: () => {
      required = true;
    },
    availability: (available: boolean) => {
      availability = [
        {
          starts_at: "2026-10-08T12:00:00Z",
          ends_at: "2026-10-08T20:00:00Z",
          available,
          recurrence: null,
        },
      ];
    },
    revokeSites: () => {
      sitesVisible = false;
    },
    hold: () => {
      hold = true;
    },
    releaseInventoryHold: () => {
      hold = false;
    },
  };
}
const createInput = {
  billing: {
    mode: "new_ticket",
    workTypeId: 3,
    afeNumber: "A1",
    workDate: "2026-10-16",
  },
  operationId: "33333333-3333-4333-8333-333333333333",
  fleetId,
  title: "Synthetic run",
  driverUserId: 2,
  vehicleAssetId: vehicle,
  stops: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      siteId: 9,
      kind: "pickup",
      sequence: 0,
    },
  ],
};
describe("Fleet durable service authority contract", () => {
  it("dispatches from the company driver pool without assigning the driver to a site", async () => {
    const f = fixture();
    f.state().grants.find(g => g.userId === driver.userId)!.siteIds = [];
    const created = await f.service.create(manager, createInput);
    const dispatched = await f.service.action(manager, created.id, {
      operationId: crypto.randomUUID(), action: "dispatch", expectedVersion: created.version,
    });
    const overview = await f.service.overview(driver);
    expect(overview.capabilities.canDrive).toBe(true);
    expect(overview.capabilities.canDispatch).toBe(false);
    expect(overview.runs.map(run => run.id)).toEqual([created.id]);
    const acknowledged = await f.service.action(driver, created.id, {
      operationId: crypto.randomUUID(), action: "acknowledge", expectedVersion: dispatched.version,
    });
    expect(acknowledged.status).toBe("acknowledged");
    await expect(f.service.create(driver, {...createInput,operationId:crypto.randomUUID()})).rejects.toMatchObject({code:"fleet.dispatch_required"});
    f.state().grants.find(g => g.userId === driver.userId)!.roles = [];
    await expect(f.service.detail(driver, created.id)).rejects.toMatchObject({code:"fleet.not_found"});
  });
  it("does not expose historical driver assignments after the current assignment changes", async () => {
    const f = fixture();
    const created = await f.service.create(manager, createInput);
    f.state().grants.find(g => g.userId === driver.userId)!.siteIds = [];
    const current = {...created,driverUserId:stranger.userId,version:created.version+1};
    await expect(f.service.detail({...driver,currentRunsById:new Map([[created.id,current]])},created.id)).rejects.toMatchObject({code:"fleet.not_found"});
  });
  it("keeps the company driver and Detail directory usable before customer setup", async () => {
    const f = fixture();
    f.state().fleets[0].siteIds = [];
    f.state().grants.forEach(g => {g.siteIds=[];});
    const overview=await f.service.overview(manager);
    expect(overview.capabilities).toMatchObject({canManageResources:true,canDispatch:false,canMaintain:true,canReportDefect:true});
    expect(overview.fleets.map(group=>group.id)).toEqual([fleetId]);
    await expect(f.service.resources(manager)).resolves.toHaveProperty("drivers");
    await expect(f.service.readFleetDetails(manager,{})).resolves.toHaveProperty("details");
    await expect(f.service.create(manager,createInput)).rejects.toMatchObject({code:"fleet.dispatch_required"});
  });
  it("offers enrolled Inventory assets to a company administrator without changing access-group membership", async () => {
    const f = fixture();
    f.state().fleets[0].equipmentAssetIds = [];
    expect(
      (
        await f.service.resources({
          ...manager,
          role: "vendor",
          membershipRole: "admin",
        })
      ).equipment.map((item) => item.id),
    ).toContain(vehicle);
    expect(f.state().fleets[0].equipmentAssetIds).toEqual([]);
    expect((await f.service.resources(manager)).equipment).toEqual([]);
  });
  it("retains an expired dispatch assessment when a certificate is later renewed", async () => {
    const f = fixture();
    f.state().fleets[0].requiredCertifications = ["Synthetic DOT credential"];
    f.certificates([
      {
        name: "Synthetic DOT credential",
        vendor_verified_at: "2000-01-01T00:00:00Z",
        expiration_date: "2000-01-01",
      },
    ]);
    const created = await f.service.create(manager, createInput);
    expect(created.events[0].details?.fleetCompliance).toMatchObject({
      warnings: expect.arrayContaining([
        expect.objectContaining({ reason: "expired" }),
      ]),
    });
    f.certificates([
      {
        name: "Synthetic DOT credential",
        vendor_verified_at: new Date().toISOString(),
        expiration_date: "2099-01-01",
      },
    ]);
    const dispatched = await f.service.action(manager, created.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: created.version,
      action: "dispatch",
    });
    expect(dispatched.events[0].details?.fleetCompliance).toEqual(
      created.events[0].details?.fleetCompliance,
    );
    expect(dispatched.events.at(-1)?.details?.fleetCompliance).toMatchObject({
      warnings: expect.not.arrayContaining([
        expect.objectContaining({ category: "driver_certification" }),
      ]),
    });
  });
  it("records missing document warnings at creation, dispatch and start while actual Inventory holds remain authoritative", async () => {
    const f = fixture();
    f.state().fleets[0].requiredCertifications = ["Synthetic DOT credential"];
    let run = await f.service.create(manager, createInput);
    expect(run.events[0].details?.fleetCompliance).toMatchObject({
      mode: "warn_only",
      status: "red",
      warnings: expect.arrayContaining([
        {
          reason: "missing",
          category: "driver_certification",
          requirement: "Synthetic DOT credential",
        },
      ]),
    });
    run = await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "dispatch",
    });
    expect(run.events.at(-1)?.details?.fleetCompliance).toMatchObject({
      status: "red",
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "acknowledge",
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "inspect",
      inspectionOutcome: "passed",
      notes: "Physically inspected",
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "record_meter",
      reading: 100,
      unit: "miles",
      notes: "Actual reading",
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "start",
    });
    expect(run.status).toBe("in_progress");
    expect(run.events.at(-1)?.details?.fleetCompliance).toMatchObject({
      status: "red",
    });
    f.hold();
    await expect(
      f.service.action(driver, run.id, {
        operationId: crypto.randomUUID(),
        expectedVersion: run.version,
        action: "arrive_stop",
        stopId: run.stops[0].id,
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_on_hold" });
    expect(f.state().runs[0].events[0].details?.fleetCompliance).toMatchObject({
      status: "red",
    });
  });
  it("notifies only newly committed dispatch events and never repeats alerts on exact replay", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    const input = {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "dispatch",
    };
    const dispatched = await f.service.action(manager, run.id, input);
    expect(f.state().runs[0].status).toBe("dispatched");
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveBeenCalledWith(
      [2],
      expect.objectContaining({
        type: "fleet_run_event",
        dedupeKey: `fleet:7:${input.operationId}`,
      }),
    );
    expect(await f.service.action(manager, run.id, input)).toMatchObject({
      version: dispatched.version,
    });
    expect(notifications).toHaveBeenCalledTimes(1);
    notifications.mockRejectedValue(new Error("Unavailable delivery"));
    const cancelled = await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: dispatched.version,
      action: "cancel",
      reason: "Synthetic cancellation",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(f.state().runs[0].status).toBe("cancelled");
  });
  it("reads a scoped review packet and refuses closeout with missing snapshotted evidence", async () => {
    const f = fixture();
    f.state().fleets[0].operationalProfile = {
      name: "Saved receipt required",
      inspectionItems: [],
      manifestFields: [],
      evidenceRequirements: [
        {
          id: "receipt",
          label: "Saved receipt",
          kind: "receipt",
          scope: "run",
          required: true,
        },
      ],
    };
    const created = await f.service.create(manager, createInput);
    const run = f.state().runs[0];
    run.status = "in_progress";
    run.phase = null;
    run.visitedStopIds = run.stops.map((stop) => stop.id);
    run.loads = [
      {
        id: crypto.randomUUID(),
        pickupStopId: run.stops[0].id,
        deliveryStopId: run.stops[0].id,
        commodity: "Water",
        quantity: 1,
        unit: "bbl",
        manifestReference: "Synthetic",
        deliveryReference: "Reported",
        recordedByUserId: 2,
        recordedAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        source: "user_report" as const,
      },
    ];
    run.records = [100, 101].map((reading) => ({
      id: crypto.randomUUID(),
      vehicleAssetId: vehicle,
      kind: "meter",
      quantity: null,
      reading,
      unit: "miles",
      notes: "Reported",
      recordedByUserId: 2,
      recordedAt: new Date().toISOString(),
      capturedAt: null,
      source: "user_report",
    }));
    f.state().fleets[0].operationalProfile!.evidenceRequirements = [];
    const packet = await f.service.reviewPacket(driver, created.id);
    expect(packet.missingRequiredCount).toBe(1);
    expect(packet.physicalProofVerified).toBe(false);
    await expect(
      f.service.action(driver, created.id, {
        operationId: crypto.randomUUID(),
        expectedVersion: run.version,
        action: "submit_closeout",
      }),
    ).rejects.toMatchObject({ code: "fleet.evidence_required" });
    expect(f.state().runs[0].status).toBe("in_progress");
    f.revokeSites();
    await expect(
      f.service.reviewPacket(driver, created.id),
    ).rejects.toMatchObject({ code: "fleet.not_found" });
  });
  it("snapshots configured requirements and enforces checklist before accepting a passed inspection", async () => {
    const f = fixture();
    f.state().fleets[0].operationalProfile = {
      name: "Bulk",
      inspectionItems: [{ id: "brakes", label: "Brakes", required: true }],
      manifestFields: [{ id: "seal", label: "Seal reference", required: true }],
    };
    let run = await f.service.create(manager, {
      ...createInput,
      schedule: {
        plannedStartAt: "2026-10-08T12:00:00Z",
        plannedEndAt: "2026-10-08T20:00:00Z",
        timezone: "America/Chicago",
      },
    });
    expect(run.canEditDraft).toBe(true);
    expect(run.operationalProfile?.inspectionItems).toHaveLength(1);
    f.state().fleets[0].operationalProfile = undefined;
    f.availability(true);
    run = await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      action: "dispatch",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "acknowledge",
      expectedVersion: run.version,
    });
    await expect(
      f.service.action(driver, run.id, {
        operationId: crypto.randomUUID(),
        action: "inspect",
        inspectionOutcome: "passed",
        notes: "User report",
        expectedVersion: run.version,
      }),
    ).rejects.toMatchObject({ code: "fleet.inspection_fields_required" });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "inspect",
      inspectionOutcome: "passed",
      inspectionResponses: [{ id: "brakes", outcome: "passed" }],
      notes: "Actually checked",
      expectedVersion: run.version,
    });
    expect(run.inspections[0].responses).toEqual([
      { id: "brakes", outcome: "passed" },
    ]);
    expect(run.operationalProfile?.manifestFields[0].id).toBe("seal");
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "record_meter",
      reading: 100,
      unit: "miles",
      notes: "Actual meter",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "start",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "arrive_stop",
      stopId: run.stops[0].id,
      expectedVersion: run.version,
    });
    const load = {
      operationId: crypto.randomUUID(),
      action: "record_load",
      loadId: crypto.randomUUID(),
      commodity: "Bulk",
      quantity: 20,
      unit: "tons",
      manifestReference: "Fictional fixture manifest",
      expectedVersion: run.version,
    };
    await expect(f.service.action(driver, run.id, load)).rejects.toMatchObject({
      code: "fleet.load_fields_required",
    });
    run = await f.service.action(driver, run.id, {
      ...load,
      manifestValues: { seal: "Actual user-reported seal" },
    });
    expect(run.loads[0].manifestValues).toEqual({
      seal: "Actual user-reported seal",
    });
    expect(run.loads[0].source).toBe("user_report");
  });
  it("allows scheduled planning but denies dispatch without covering saved availability", async () => {
    const f = fixture();
    const run = await f.service.create(manager, {
      ...createInput,
      schedule: {
        plannedStartAt: "2026-10-08T12:00:00Z",
        plannedEndAt: "2026-10-08T20:00:00Z",
        timezone: "America/Chicago",
      },
    });
    const command = {
      operationId: crypto.randomUUID(),
      action: "dispatch",
      expectedVersion: run.version,
    };
    await expect(
      f.service.action(manager, run.id, command),
    ).rejects.toMatchObject({ code: "fleet.driver_availability_unknown" });
    expect(f.state().runs[0].status).toBe("draft");
    expect(f.state().runs[0].version).toBe(run.version);
    f.availability(false);
    await expect(
      f.service.action(manager, run.id, command),
    ).rejects.toMatchObject({ code: "fleet.driver_schedule_conflict" });
    f.availability(true);
    const saved = await f.service.action(manager, run.id, command);
    f.availability(false);
    expect(await f.service.action(manager, run.id, command)).toEqual(saved);
    expect(f.state().runs[0].version).toBe(run.version + 1);
  });
  it("retains inspection exceptions and requires inventory release before a later passed inspection can start", async () => {
    const f = fixture();
    let run = await f.service.create(manager, createInput);
    run = await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      action: "dispatch",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "acknowledge",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "record_meter",
      reading: 100,
      unit: "miles",
      notes: "Reported odometer",
      expectedVersion: run.version,
    });
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "inspect",
      inspectionOutcome: "defect_reported",
      notes: "Reported inspection exception",
      expectedVersion: run.version,
    });
    expect(run.events.at(-1)?.details?.maintenanceIds).toHaveLength(1);
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "inspect",
      inspectionOutcome: "passed",
      notes: "User reports later inspection passed",
      expectedVersion: run.version,
    });
    await expect(
      f.service.action(driver, run.id, {
        operationId: crypto.randomUUID(),
        action: "start",
        expectedVersion: run.version,
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_on_hold" });
    expect(f.state().runs[0].status).toBe("acknowledged");
    f.releaseInventoryHold();
    run = await f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "start",
      expectedVersion: run.version,
    });
    expect(run.status).toBe("in_progress");
    expect(run.inspections.map((i) => i.outcome)).toEqual([
      "defect_reported",
      "passed",
    ]);
  });
  it("keeps offline proposed hauling phases aligned with canonical acceptance without fabricating records", async () => {
    const f = fixture(),
      deliveryId = crypto.randomUUID(),
      loadId = crypto.randomUUID();
    let run = await f.service.create(manager, {
      ...createInput,
      stops: [
        ...createInput.stops,
        { id: deliveryId, siteId: 9, kind: "delivery", sequence: 1 },
      ],
    });
    run = await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: run.version,
      action: "dispatch",
    });
    const base = structuredClone(run),
      original = JSON.stringify(base);
    const queued: ReturnType<typeof FleetActionInputSchema.parse>[] = [];
    const inputs = [
      { action: "acknowledge" },
      {
        action: "inspect",
        inspectionOutcome: "passed",
        notes: "Driver reports inspection",
      },
      {
        action: "record_meter",
        reading: 100,
        unit: "miles",
        notes: "Driver reports initial odometer",
      },
      { action: "start" },
      { action: "arrive_stop", stopId: createInput.stops[0].id },
      {
        action: "record_load",
        loadId,
        commodity: "Synthetic gravel",
        quantity: 10,
        unit: "tons",
        manifestReference: "fictional-manifest",
      },
      { action: "depart_stop", stopId: createInput.stops[0].id },
      { action: "arrive_stop", stopId: deliveryId },
      {
        action: "record_delivery",
        loadId,
        deliveryReference: "fictional-delivery",
      },
      { action: "depart_stop", stopId: deliveryId },
      {
        action: "record_meter",
        reading: 110,
        unit: "miles",
        notes: "Driver reports final odometer",
      },
      { action: "submit_closeout" },
    ];
    for (const fields of inputs) {
      const command = FleetActionInputSchema.parse({
        ...fields,
        operationId: crypto.randomUUID(),
        expectedVersion: run.version,
        capturedAt: new Date().toISOString(),
        source: "user_report",
      });
      queued.push(command);
      const proposed = previewFleetRunActions(base, queued);
      run = await f.service.action(driver, run.id, command);
      expect(proposed).toMatchObject({
        unsynced: true,
        expectedVersion: run.version,
        status: run.status,
        phase: run.phase,
        currentStopId: run.currentStopId,
        visitedStopIds: run.visitedStopIds,
      });
      expect(proposed.loads.map((l) => l.delivered)).toEqual(
        run.loads.map((l) => Boolean(l.deliveredAt)),
      );
    }
    expect(JSON.stringify(base)).toBe(original);
    expect(base.events).toHaveLength(2);
    expect(run.status).toBe("submitted_for_review");
    expect(() =>
      previewFleetRunActions(base, [{ ...queued[0], expectedVersion: 99 }]),
    ).toThrow();
  });
  it("creates/replays a draft without dispatch or fabricated telemetry", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    expect(run.status).toBe("draft");
    expect(run.loads).toEqual([]);
    expect(await f.service.create(manager, createInput)).toEqual(run);
    expect(f.state().runs).toHaveLength(1);
    expect((await f.service.overview(manager)).observations).toEqual([]);
  });
  it("rejects driver dispatch creation and unrelated member detail", async () => {
    const f = fixture();
    await expect(f.service.create(driver, createInput)).rejects.toMatchObject({
      code: "fleet.dispatch_required",
    });
    const run = await f.service.create(manager, createInput);
    await expect(f.service.detail(stranger, run.id)).rejects.toMatchObject({
      code: "fleet.not_found",
    });
  });
  it("checks holds again at dispatch and commits no partial status", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    f.hold();
    await expect(
      f.service.action(manager, run.id, {
        operationId: crypto.randomUUID(),
        action: "dispatch",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_on_hold" });
    expect(f.state().runs[0].status).toBe("draft");
  });
  it("permits only the assigned driver acknowledgement with version and replay checks", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      action: "dispatch",
      expectedVersion: 1,
    });
    await expect(
      f.service.action(manager, run.id, {
        operationId: crypto.randomUUID(),
        action: "acknowledge",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    const input = {
      operationId: crypto.randomUUID(),
      action: "acknowledge",
      expectedVersion: 2,
    };
    const result = await f.service.action(driver, run.id, input);
    expect(result.status).toBe("acknowledged");
    expect(await f.service.action(driver, run.id, input)).toEqual(result);
    await expect(
      f.service.action(driver, run.id, { ...input, expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
  });
  it("rejects stale versions and conflicting active equipment assignments", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    await expect(
      f.service.action(manager, run.id, {
        operationId: crypto.randomUUID(),
        action: "dispatch",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "fleet.version_conflict" });
    await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      action: "dispatch",
      expectedVersion: 1,
    });
    await expect(
      f.service.create(manager, {
        ...createInput,
        operationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "fleet.assignment_conflict" });
  });
  it("keeps cancelled work terminal and revocation fail-closed", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    await f.service.action(manager, run.id, {
      operationId: crypto.randomUUID(),
      action: "cancel",
      expectedVersion: 1,
      reason: "Synthetic cancellation",
    });
    await expect(
      f.service.action(manager, run.id, {
        operationId: crypto.randomUUID(),
        action: "dispatch",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    f.state().grants = [];
    await expect(f.service.detail(driver, run.id)).rejects.toMatchObject({
      code: "fleet.not_found",
    });
  });
  it("records ordered pickup/delivery cycles and review without inventing evidence", async () => {
    const f = fixture();
    const deliveryId = crypto.randomUUID();
    const run = await f.service.create(manager, {
      ...createInput,
      stops: [
        ...createInput.stops,
        { id: deliveryId, siteId: 9, kind: "delivery", sequence: 1 },
      ],
    });
    let version = run.version;
    const act = async (
      who: typeof manager,
      action: string,
      extra: Record<string, unknown> = {},
    ) => {
      const next = await f.service.action(who, run.id, {
        operationId: crypto.randomUUID(),
        expectedVersion: version,
        action,
        ...extra,
      });
      version = next.version;
      return next;
    };
    await act(manager, "dispatch");
    await act(driver, "acknowledge");
    await expect(act(driver, "start")).rejects.toMatchObject({
      code: "fleet.action_forbidden",
    });
    await act(driver, "inspect", {
      inspectionOutcome: "passed",
      notes: "Actual user-reported inspection",
    });
    await act(driver, "record_meter", {
      reading: 1000,
      unit: "miles",
      notes: "Actual odometer before departure",
    });
    await act(driver, "start");
    await act(driver, "pause", { reason: "Actual driver wait" });
    await act(driver, "resume");
    await expect(
      act(driver, "arrive_stop", { stopId: deliveryId }),
    ).rejects.toMatchObject({ code: "fleet.stop_order_conflict" });
    await act(driver, "arrive_stop", { stopId: createInput.stops[0].id });
    await expect(
      act(driver, "depart_stop", { stopId: createInput.stops[0].id }),
    ).rejects.toMatchObject({ code: "fleet.load_required" });
    const loadId = crypto.randomUUID();
    await act(driver, "record_load", {
      loadId,
      commodity: "Synthetic sand",
      quantity: 20,
      unit: "tons",
      manifestReference: "Synthetic manifest",
      capturedAt: new Date().toISOString(),
      source: "user_report",
    });
    await act(driver, "depart_stop", { stopId: createInput.stops[0].id });
    await act(driver, "arrive_stop", { stopId: deliveryId });
    await expect(
      act(driver, "depart_stop", { stopId: deliveryId }),
    ).rejects.toMatchObject({ code: "fleet.delivery_required" });
    await act(driver, "record_delivery", {
      loadId,
      deliveryReference: "Synthetic delivery",
    });
    await act(driver, "depart_stop", { stopId: deliveryId });
    await act(driver, "record_meter", {
      reading: 1050,
      unit: "miles",
      notes: "Actual ending odometer",
    });
    await act(driver, "submit_closeout");
    await expect(
      act(driver, "review", { decision: "accept", reason: "Unauthorized" }),
    ).rejects.toMatchObject({ code: "fleet.action_forbidden" });
    await act(manager, "review", {
      decision: "return",
      reason: "Add correction note",
    });
    await expect(act(driver, "submit_closeout")).rejects.toMatchObject({
      code: "fleet.correction_notes_required",
    });
    await act(driver, "submit_closeout", {
      notes: "Corrected manifest confirmed by user",
    });
    const completed = await act(manager, "review", {
      decision: "accept",
      reason: "Reviewed user-reported records",
    });
    expect(completed.status).toBe("completed");
    expect(completed.linkedTicketId).toBe(10);
    expect(completed.loads[0].source).toBe("user_report");
    expect(completed.events.at(-1)?.details?.reason).toBe(
      "Reviewed user-reported records",
    );
    expect((await f.service.overview(manager)).observations).toEqual([]);
  });
  it("refuses future and outlier capture times without mutation", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    for (const capturedAt of [
      new Date(Date.now() + 600000).toISOString(),
      new Date(Date.now() - 31 * 86400000).toISOString(),
    ])
      await expect(
        f.service.action(manager, run.id, {
          operationId: crypto.randomUUID(),
          expectedVersion: 1,
          action: "dispatch",
          capturedAt,
        }),
      ).rejects.toMatchObject({ code: "fleet.capture_time_invalid" });
    expect(f.state().runs[0].version).toBe(1);
  });
  it("rechecks revoked site authority for both reads and existing-run writes", async () => {
    const f = fixture();
    const run = await f.service.create(manager, createInput);
    f.revokeSites();
    expect((await f.service.overview(manager)).runs).toEqual([]);
    expect((await f.service.overview(manager)).capabilities.canDispatch).toBe(
      false,
    );
    await expect(f.service.detail(driver, run.id)).rejects.toMatchObject({
      code: "fleet.not_found",
    });
    await expect(
      f.service.action(manager, run.id, {
        operationId: crypto.randomUUID(),
        action: "cancel",
        expectedVersion: 1,
        reason: "No authority",
      }),
    ).rejects.toMatchObject({ code: "fleet.not_found" });
  });
  it("never grants setup based on a different administrative context", async () => {
    const f = fixture();
    await expect(
      f.service.setupRead({
        ...manager,
        role: "field_employee",
        membershipRole: "field_employee",
      }),
    ).rejects.toMatchObject({ code: "fleet.company_admin_required" });
    expect(
      (
        await f.service.overview({
          ...manager,
          role: "field_employee",
          membershipRole: "field_employee",
        })
      ).capabilities.canSetup,
    ).toBe(false);
  });
  it("treats an empty persisted role set as full Fleet revocation", async () => {
    const f = fixture();
    await f.service.create(manager, createInput);
    f.state().grants.find((g) => g.userId === manager.userId)!.roles = [];
    const overview = await f.service.overview(manager);
    expect(overview.roles).toEqual([]);
    expect(overview.fleets).toEqual([]);
    expect(overview.runs).toEqual([]);
    expect(overview.capabilities.canDispatch).toBe(false);
  });
});
it("projects commercial routing without financial fields unless the current scoped finance grant permits it", async () => {
  const f = fixture();
  const created = await f.service.create(manager, createInput);
  const destination = {
    id: crypto.randomUUID(),
    revision: 1,
    name: "Synthetic yard",
    kind: "yard" as const,
    address: "123 Test Road",
    latitude: 35,
    longitude: -97,
    materials: [],
    hours: "",
    instructions: "",
    active: true,
    ownerType: "vendor" as const,
    ownerId: 7,
  };
  const saved = f.state().runs[0];
  saved.commercial = {
    ticketId: 88,
    originSiteId: 9,
    mode: "batch",
    rateCents: 12500,
    currency: "USD",
    approvedDestinations: [destination],
    destinationId: destination.id,
    billedLineId: 123,
  };
  const own = await f.service.detail(driver, created.id);
  expect(own.commercial).toMatchObject({
    ticketId: 88,
    originSiteId: 9,
    mode: "batch",
    approvedDestinations: [destination],
    destinationId: destination.id,
  });
  expect(own.commercial).not.toHaveProperty("rateCents");
  expect(own.commercial).not.toHaveProperty("billedLineId");
  expect(FleetRunSchema.parse(own).commercial).not.toHaveProperty(
    "billedLineId",
  );
  expect(FleetRunSchema.parse(own).commercial).not.toHaveProperty("rateCents");
  expect(f.state().runs[0].commercial?.rateCents).toBe(12500);
  expect(
    (await f.service.detail(manager, created.id)).commercial,
  ).not.toHaveProperty("rateCents");
  f.state().grants.find((g) => g.userId === 1)!.financeRead = true;
  expect(
    (await f.service.detail(manager, created.id)).commercial,
  ).toMatchObject({ rateCents: 12500, billedLineId: 123 });
  f.state().grants.find((g) => g.userId === 1)!.financeRead = false;
  expect(
    (
      await f.service.detail(
        { ...manager, role: "vendor", membershipRole: "admin" },
        created.id,
      )
    ).commercial,
  ).not.toHaveProperty("rateCents");
});

it("prevents Fleet start at the lower service boundary when the driver's training is required", async () => {
  const f = fixture();
  let run = await f.service.create(manager, createInput);
  run = await f.service.action(manager, run.id, {
    operationId: crypto.randomUUID(),
    action: "dispatch",
    expectedVersion: run.version,
  });
  run = await f.service.action(driver, run.id, {
    operationId: crypto.randomUUID(),
    action: "acknowledge",
    expectedVersion: run.version,
  });
  run = await f.service.action(driver, run.id, {
    operationId: crypto.randomUUID(),
    action: "record_meter",
    reading: 100,
    unit: "miles",
    notes: "Synthetic odometer",
    expectedVersion: run.version,
  });
  run = await f.service.action(driver, run.id, {
    operationId: crypto.randomUUID(),
    action: "inspect",
    inspectionOutcome: "passed",
    notes: "Synthetic inspection",
    expectedVersion: run.version,
  });
  f.requireTraining();
  await expect(
    f.service.action(driver, run.id, {
      operationId: crypto.randomUUID(),
      action: "start",
      expectedVersion: run.version,
    }),
  ).rejects.toMatchObject({
    code: "work_hub.required_completion",
    status: 409,
  });
  expect(f.state().runs[0].status).not.toBe("in_progress");
});
