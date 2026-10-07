import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  FleetRunSchema,
  FleetEvidenceSchema,
  FleetOperationalProfileSchema,
} from "@workspace/api-zod";
import { buildFleetReviewPacket } from "./fleet-review-packet";
function fixture() {
  const stopId = randomUUID();
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    companyId: 7,
    fleetId: randomUUID(),
    title: "Synthetic",
    driverUserId: 2,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9],
    status: "in_progress",
    phase: null,
    version: 3,
    stops: [{ id: stopId, siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    records: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [stopId],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
    operationalProfile: {
      name: "Hauling",
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
        {
          id: "scale",
          label: "Load scale document",
          kind: "scale",
          scope: "each_load",
          required: true,
        },
      ],
    },
  });
  run.loads.push(
    ...[1, 2].map(() => ({
      id: randomUUID(),
      pickupStopId: stopId,
      deliveryStopId: stopId,
      commodity: "Water",
      quantity: 2,
      unit: "bbl",
      manifestReference: "Synthetic",
      deliveryReference: "Reported",
      recordedByUserId: 2,
      recordedAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
      source: "user_report" as const,
    })),
  );
  run.inspections = [
    {
      driverUserId: 2,
      vehicleAssetId: run.vehicleAssetId,
      trailerAssetId: null,
      outcome: "passed",
      notes: "Actual reported inspection",
      recordedByUserId: 2,
      recordedAt: new Date().toISOString(),
      source: "user_report",
    },
  ];
  run.records = [100, 101].map((reading) => ({
    id: randomUUID(),
    vehicleAssetId: run.vehicleAssetId,
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
  const evidence = (kind: "receipt" | "scale", loadId: string | null) =>
    FleetEvidenceSchema.parse({
      evidenceId: randomUUID(),
      runId: run.id,
      companyId: 7,
      operationId: randomUUID(),
      runVersion: 3,
      kind,
      stopId: null,
      loadId,
      notes: "Synthetic saved metadata",
      size: 10,
      contentType: "application/pdf",
      sha256: "a".repeat(64),
      recordedByUserId: 2,
      recordedAt: new Date().toISOString(),
      capturedAt: null,
      source: "device_upload",
      physicalProofVerified: false,
      signatureIdentityVerified: false,
      fileUrl: "/private",
    });
  return { run, evidence };
}
describe("Fleet operational review packet", () => {
  it("matches exact run/load/kind associations and exposes missing required evidence without claiming physical proof", () => {
    const { run, evidence } = fixture();
    const saved = [
      evidence("receipt", null),
      evidence("scale", run.loads[0].id),
      { ...evidence("scale", run.loads[1].id), runId: randomUUID() },
      { ...evidence("scale", run.loads[1].id), companyId: 99 },
    ];
    const packet = buildFleetReviewPacket(run, saved);
    expect(packet.missingRequiredCount).toBe(1);
    expect(
      packet.requirements.find((row) => row.loadId === run.loads[1].id),
    ).toMatchObject({ missing: true, evidenceIds: [] });
    expect(packet.readyForOperationalReview).toBe(false);
    expect(packet.physicalProofVerified).toBe(false);
    expect(packet.signatureIdentityVerified).toBe(false);
    expect(JSON.stringify(packet)).not.toContain("/private");
    expect(
      buildFleetReviewPacket(run, [
        ...saved,
        evidence("scale", run.loads[1].id),
      ]).readyForOperationalReview,
    ).toBe(true);
  });
  it("keeps unconfigured profiles compatible and refuses duplicate requirement identifiers", () => {
    const { run } = fixture();
    delete run.operationalProfile!.evidenceRequirements;
    expect(buildFleetReviewPacket(run, []).missingRequiredCount).toBe(0);
    const rule = {
      id: "photo",
      label: "Photo",
      kind: "photo",
      scope: "run",
      required: true,
    };
    expect(
      FleetOperationalProfileSchema.safeParse({
        ...run.operationalProfile,
        evidenceRequirements: [rule, rule],
      }).success,
    ).toBe(false);
  });
});
