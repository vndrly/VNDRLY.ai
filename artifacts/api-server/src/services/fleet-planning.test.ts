import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FleetRunSchema,
  FleetScheduleSchema,
  checkFleetInspectionRequirements,
  checkFleetManifestRequirements,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import { createFleetPlanningOperations } from "./fleet-planning";
function fixture() {
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    fleetId: randomUUID(),
    companyId: 7,
    title: "Original",
    driverUserId: 2,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9],
    status: "draft",
    phase: null,
    version: 1,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
  const state = {
    ...emptyFleetState(),
    enabled: true,
    runs: [run],
    fleets: [
      {
        id: run.fleetId,
        name: "Synthetic",
        siteIds: [9],
        equipmentAssetIds: [],
        requiredCertifications: [],
      },
    ],
    grants: [
      {
        userId: 1,
        fleetIds: [run.fleetId],
        siteIds: [9],
        roles: ["dispatcher" as const],
        safetyRelease: false,
        financeRead: false,
      },
    ],
  };
  const actor: FleetActor = { userId: 1, companyId: 7 };
  let permission = true,
    eligible = true;
  const transaction = async <T>(
    bound: FleetActor,
    op: (state: FleetState, client: PoolClient) => Promise<T>,
  ) => {
    bound.activeSiteIds = [9];
    return op(state, {} as PoolClient);
  };
  const service = createFleetPlanningOperations(
    transaction,
    () => permission,
    async () => {
      if (!eligible) throw new Error("Held equipment");
    },
    (_s, _a, r) => structuredClone(r),
  );
  return {
    run,
    state,
    actor,
    service,
    revoke: () => {
      permission = false;
    },
    hold: () => {
      eligible = false;
    },
  };
}
describe("Fleet draft planning and explicit requirements", () => {
  it("edits only a draft with exact CAS/replay and immutable saved result", async () => {
    const f = fixture(),
      input = {
        operationId: randomUUID(),
        expectedVersion: 1,
        title: "Scheduled",
        schedule: {
          plannedStartAt: "2026-10-08T12:00:00Z",
          plannedEndAt: "2026-10-08T20:00:00Z",
          timezone: "America/Chicago",
        },
      };
    const result = await f.service.editDraft(f.actor, f.run.id, input);
    expect(result).toMatchObject({
      title: "Scheduled",
      version: 2,
      status: "draft",
      schedule: input.schedule,
    });
    expect(await f.service.editDraft(f.actor, f.run.id, input)).toEqual(result);
    expect(f.run.events).toHaveLength(1);
    await expect(
      f.service.editDraft(f.actor, f.run.id, { ...input, title: "Different" }),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    f.revoke();
    await expect(
      f.service.editDraft(f.actor, f.run.id, input),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects stale, dispatched, foreign-site and unavailable-equipment edits before mutation", async () => {
    const f = fixture(),
      input = { operationId: randomUUID(), expectedVersion: 1, title: "Edit" };
    await expect(
      f.service.editDraft(f.actor, f.run.id, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "fleet.version_conflict" });
    await expect(
      f.service.editDraft(f.actor, f.run.id, {
        ...input,
        stops: [{ ...f.run.stops[0], siteId: 10 }],
      }),
    ).rejects.toMatchObject({ code: "fleet.invalid_stops" });
    f.hold();
    await expect(f.service.editDraft(f.actor, f.run.id, input)).rejects.toThrow(
      "Held equipment",
    );
    f.run.status = "dispatched";
    await expect(
      f.service.editDraft(f.actor, f.run.id, input),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.run.title).toBe("Original");
    expect(f.run.events).toEqual([]);
  });
  it("requires configured actual checklist/manifest values without claiming physical proof", () => {
    const profile = {
      name: "Bulk",
      inspectionItems: [{ id: "brakes", label: "Brakes", required: true }],
      manifestFields: [{ id: "seal", label: "Seal reference", required: true }],
    };
    expect(checkFleetInspectionRequirements(profile, undefined, "passed")).toBe(
      false,
    );
    expect(
      checkFleetInspectionRequirements(
        profile,
        [{ id: "brakes", outcome: "not_applicable" }],
        "passed",
      ),
    ).toBe(false);
    expect(
      checkFleetInspectionRequirements(
        profile,
        [{ id: "brakes", outcome: "defect_reported" }],
        "passed",
      ),
    ).toBe(false);
    expect(
      checkFleetInspectionRequirements(
        profile,
        [{ id: "brakes", outcome: "passed" }],
        "passed",
      ),
    ).toBe(true);
    expect(checkFleetManifestRequirements(profile, undefined)).toBe(false);
    expect(
      checkFleetManifestRequirements(profile, { seal: "Actual user report" }),
    ).toBe(true);
    expect(
      checkFleetManifestRequirements(profile, {
        seal: "Actual",
        invented: "Unknown requirement",
      }),
    ).toBe(false);
    expect(
      FleetScheduleSchema.safeParse({
        plannedStartAt: "2026-10-08T20:00:00Z",
        plannedEndAt: "2026-10-08T12:00:00Z",
        timezone: "America/Chicago",
      }).success,
    ).toBe(false);
  });
});
