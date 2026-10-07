import {
  FleetEvidenceSchema,
  FleetReviewPacketSchema,
  checkFleetInspectionRequirements,
  checkFleetManifestRequirements,
  type FleetEvidence,
  type FleetRun,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { FleetError } from "./fleet-repository";
export function buildFleetReviewPacket(
  run: FleetRun,
  evidence: FleetEvidence[],
) {
  const actual = evidence.filter(
    (item) =>
      item.runId === run.id &&
      item.companyId === run.companyId &&
      (!item.loadId || run.loads.some((load) => load.id === item.loadId)),
  );
  const requirements = (
    run.operationalProfile?.evidenceRequirements ?? []
  ).flatMap((rule) => {
    const loads =
      rule.scope === "each_load"
        ? run.loads.filter((load) => !load.transferOut).map((load) => load.id)
        : [null];
    return loads.map((loadId) => {
      const evidenceIds = actual
        .filter(
          (item) =>
            item.kind === rule.kind &&
            (loadId === null ? item.loadId === null : item.loadId === loadId),
        )
        .map((item) => item.evidenceId);
      return {
        ...rule,
        loadId,
        evidenceIds,
        missing: evidenceIds.length === 0,
      };
    });
  });
  const missingRequiredCount = requirements.filter(
    (item) => item.required && item.missing,
  ).length;
  const inspectionExceptions = run.inspections.filter(
    (item) => item.outcome === "defect_reported",
  ).length;
  const undeliveredLoadCount = run.loads.filter(
    (item) => !item.deliveredAt && !item.transferOut,
  ).length;
  const inspection = run.inspections.at(-1);
  const inspectionComplete =
    !!inspection &&
    inspection.driverUserId === run.driverUserId &&
    inspection.vehicleAssetId === run.vehicleAssetId &&
    inspection.trailerAssetId === run.trailerAssetId &&
    inspection.outcome === "passed" &&
    checkFleetInspectionRequirements(
      run.operationalProfile,
      inspection.responses,
      inspection.outcome,
    );
  const manifestComplete = run.loads
    .filter((load) => !load.transferOut)
    .every((load) =>
      checkFleetManifestRequirements(
        run.operationalProfile,
        load.manifestValues,
      ),
    );
  const closeoutRecordsComplete =
    run.loads.length > 0 &&
    undeliveredLoadCount === 0 &&
    run.currentStopId === null &&
    run.visitedStopIds.length === run.stops.length &&
    run.phase !== "paused" &&
    run.records.filter(
      (record, index) =>
        record.kind === "meter" &&
        record.vehicleAssetId === run.vehicleAssetId &&
        ["miles", "kilometers"].includes(record.unit) &&
        (!run.activeReplacement || index >= run.activeReplacement.recordCount),
    ).length >= 2;
  return FleetReviewPacketSchema.parse({
    runId: run.id,
    runVersion: run.version,
    status: run.status,
    requirements,
    missingRequiredCount,
    readyForOperationalReview:
      missingRequiredCount === 0 &&
      inspectionComplete &&
      manifestComplete &&
      closeoutRecordsComplete,
    inspectionComplete,
    manifestComplete,
    closeoutRecordsComplete,
    inspectionExceptions,
    undeliveredLoadCount,
    source: "recorded_fleet_records",
    physicalProofVerified: false,
    signatureIdentityVerified: false,
    limitations: [
      "Saved file associations and user reports do not verify physical events or signature identity.",
      "Readiness checks configured evidence completeness; current role, lifecycle, inspection, meter and safety checks remain authoritative.",
    ],
  });
}
export async function readFleetReviewPacket(client: PoolClient, run: FleetRun) {
  const result = await client.query(
    "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND tool_output->'record'->>'runId'=$2 ORDER BY id LIMIT 101",
    [run.companyId, run.id],
  );
  if (result.rows.length > 100)
    throw new FleetError("fleet.store_capacity_reached");
  return buildFleetReviewPacket(
    run,
    result.rows.map((row) => FleetEvidenceSchema.parse(row.tool_output.record)),
  );
}
