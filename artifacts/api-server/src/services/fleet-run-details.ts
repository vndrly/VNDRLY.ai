import {
  FleetDetailSelectionSchema,
  FleetResourceAssignmentSchema,
  type FleetRun,
  type FleetDetailSelection,
  type FleetDetailSnapshot,
} from "@workspace/api-zod";
import { createFleetDetailsOperations } from "./fleet-details";
import {
  reserveFleetDetail,
  releaseFleetReservation,
} from "./fleet-reservations";
import type { FleetResourcesTransaction } from "./fleet-resource-store";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import { readFleetResourceAssets } from "./fleet-resource-store";

/** Reuse the Details scope/snapshot service inside the caller's transaction.
 * This adapter never opens or commits a nested transaction. */
export async function resolveFleetRunDetailSnapshot(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  run: FleetRun,
  raw: FleetDetailSelection,
) {
  const selection = FleetDetailSelectionSchema.parse(raw);
  if (run.schedule && run.schedule.timezone !== selection.timeZone)
    throw new FleetError("fleet.invalid_schedule", 400);
  const reader = createFleetDetailsOperations(
    async (_actor, work) => work(tx.state, tx.client),
    (state, current) =>
      state.grants.find((grant) => grant.userId === current.userId) ?? null,
  );
  const snapshot = await reader.fleetDetailSnapshot(actor, selection.detailId, run.driverUserId);
  const trailer =
    snapshot.rigPackage?.components.find(
      (component) => component.role === "trailer",
    )?.assetId ?? null;
  if (snapshot.detail.version !== selection.detailVersion)
    throw new FleetError("fleet.detail_revision_conflict");
  if (
    !snapshot.detail.accessGroupIds.includes(run.fleetId) ||
    snapshot.detail.driverUserId !== run.driverUserId ||
    snapshot.detail.vehicleAssetId !== run.vehicleAssetId ||
    trailer !== run.trailerAssetId
  )
    throw new FleetError("fleet.detail_assignment_mismatch", 409);
  if (
    selection.returnPolicy === "return_required" &&
    run.stops.at(-1)?.kind !== "return"
  )
    throw new FleetError("fleet.return_stop_required", 400);
  if (snapshot.detail.archivedAt)
    throw new FleetError("fleet.detail_revision_conflict");
  return { selection, snapshot };
}
export async function assignFleetRunDetail(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  run: FleetRun,
  raw: FleetDetailSelection,
) {
  const { selection, snapshot } = await resolveFleetRunDetailSnapshot(
    tx,
    actor,
    run,
    raw,
  );
  const reservation = await reserveFleetDetail(tx, actor, {
    runId: run.id,
    detailSnapshot: snapshot,
    startAt: run.schedule?.plannedStartAt ?? new Date().toISOString(),
    plannedEndAt: run.schedule?.plannedEndAt ?? null,
    timeZone: selection.timeZone,
  });
  run.resourceAssignment = FleetResourceAssignmentSchema.parse({
    version: 2,
    snapshot,
    reservation,
    returnPolicy: selection.returnPolicy,
  });
}
export async function rescheduleFleetRunDetail(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  run: FleetRun,
) {
  const assignment = run.resourceAssignment;
  if (!assignment) return;
  await releaseFleetReservation(tx, actor, {
    runId: run.id,
    kind: "reschedule",
    reason: "Office changed the planned run window",
    occurredAt: new Date().toISOString(),
  });
  const reservation = await reserveFleetDetail(tx, actor, {
    runId: run.id,
    detailSnapshot: assignment.snapshot,
    retainRunSnapshot: true,
    startAt: run.schedule?.plannedStartAt ?? new Date().toISOString(),
    plannedEndAt: run.schedule?.plannedEndAt ?? null,
    timeZone: run.schedule?.timezone ?? assignment.reservation.timeZone,
  });
  run.resourceAssignment = FleetResourceAssignmentSchema.parse({
    ...assignment,
    reservation,
  });
}
export async function assertFleetRunDetailResources(
  tx: FleetResourcesTransaction,
  run: FleetRun,
) {
  if (!run.resourceAssignment) return;
  return assertFleetDetailResources(tx, run.resourceAssignment.snapshot, run);
}
export async function assertFleetDetailResources(
  tx: FleetResourcesTransaction,
  snapshot: FleetDetailSnapshot,
  run: Pick<
    FleetRun,
    "companyId" | "driverUserId" | "vehicleAssetId" | "fleetId"
  >,
) {
  const ids = [
    snapshot.detail.vehicleAssetId,
    ...(snapshot.rigPackage?.components.map((item) => item.assetId) ?? []),
  ];
  if (
    snapshot.detail.companyId !== run.companyId ||
    snapshot.detail.driverUserId !== run.driverUserId ||
    snapshot.detail.vehicleAssetId !== run.vehicleAssetId
  )
    throw new FleetError("fleet.detail_assignment_mismatch");
  const assets = await readFleetResourceAssets(
    tx.client,
    { companyId: run.companyId, userId: run.driverUserId },
    tx.state,
    ids,
  );
  if (!snapshot.detail.accessGroupIds.includes(run.fleetId))
    throw new FleetError("fleet.equipment_grant_required", 403);
  for (const asset of assets) {
    if (!["available", "checked_out"].includes(asset.status))
      throw new FleetError("fleet.equipment_unavailable");
    if (
      asset.status === "checked_out" &&
      asset.current_holder_user_id !== run.driverUserId
    )
      throw new FleetError("fleet.equipment_custody_conflict");
    const role = snapshot.rigPackage?.components.find(
      (item) => item.assetId === asset.id,
    )?.role;
    if (
      asset.id === run.vehicleAssetId
        ? !["vehicle", "truck"].includes(asset.category)
        : role !== "accessory" && role !== asset.category
    )
      throw new FleetError("fleet.equipment_kind_required");
  }
  const held = await tx.client.query(
    "SELECT id FROM asset_holds WHERE asset_id=ANY($1::uuid[]) AND released_at IS NULL",
    [ids],
  );
  if (held.rows.length) throw new FleetError("fleet.equipment_on_hold");
}
