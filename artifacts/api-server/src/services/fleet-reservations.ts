import { randomUUID } from "node:crypto";
import {
  FleetDetailSchema,
  FleetDetailSnapshotSchema,
  FleetRigPackageSchema,
  FleetReservationSchema,
  type FleetDetailSnapshot,
  type FleetReservation,
  type FleetRun,
} from "@workspace/api-zod";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import {
  appendFleetResourceRecord,
  readFleetResourceAssets,
  readFleetResourceRegistry,
  writeFleetResourceRegistry,
  type FleetResourcesTransaction,
} from "./fleet-resource-store";

export function fleetReservationConflicts(
  candidate: FleetReservation,
  existing: ReadonlyArray<FleetReservation>,
): FleetReservation[] {
  const start = Date.parse(candidate.startAt),
    end = candidate.plannedEndAt
      ? Date.parse(candidate.plannedEndAt)
      : Infinity;
  return existing.filter(
    (row) =>
      row.runId !== candidate.runId &&
      ["reserved", "active"].includes(row.state) &&
      (row.driverUserId === candidate.driverUserId ||
        row.assetIds.some((id) => candidate.assetIds.includes(id))) &&
      start <
        (row.state === "active" || row.plannedEndAt === null
          ? Infinity
          : Date.parse(row.plannedEndAt)) &&
      Date.parse(row.startAt) < end,
  );
}
export function fleetOperationalReleaseReady(value: {
  closed: boolean;
  returnPolicy: "delivery_only" | "return_required";
  returnRecorded: boolean;
}): boolean {
  return (
    value.closed &&
    (value.returnPolicy === "delivery_only" || value.returnRecorded)
  );
}
export async function reserveFleetDetail(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  input: {
    runId: string;
    detailSnapshot: FleetDetailSnapshot;
    startAt: string;
    plannedEndAt: string | null;
    timeZone: string;
    retainRunSnapshot?: boolean;
  },
): Promise<FleetReservation> {
  const snapshot = FleetDetailSnapshotSchema.parse(input.detailSnapshot);
  if (actor.readOnly || snapshot.detail.companyId !== actor.companyId)
    throw new FleetError("fleet.dispatch_required", 403);
  const registry = await readFleetResourceRegistry(tx.client, actor.companyId);
  const savedRun = tx.state.runs.find((row) => row.id === input.runId);
  const retain =
    input.retainRunSnapshot === true &&
    savedRun &&
    ["draft", "dispatched", "acknowledged"].includes(savedRun.status) &&
    JSON.stringify(savedRun.resourceAssignment?.snapshot) ===
      JSON.stringify(snapshot);
  if (input.retainRunSnapshot && !retain)
    throw new FleetError("fleet.detail_revision_conflict");
  const detail = retain
    ? snapshot.detail
    : registry.details.find((row) => row.id === snapshot.detail.id);
  if (
    !detail ||
    JSON.stringify(FleetDetailSchema.parse(detail)) !==
      JSON.stringify(snapshot.detail) ||
    detail.archivedAt ||
    (detail.effectiveUntil &&
      (Date.parse(input.startAt) >= Date.parse(detail.effectiveUntil) ||
        (input.plannedEndAt &&
          Date.parse(input.plannedEndAt) >
            Date.parse(detail.effectiveUntil)))) ||
    Date.parse(input.startAt) < Date.parse(detail.effectiveFrom)
  )
    throw new FleetError("fleet.detail_revision_conflict");
  const grant = tx.state.grants.find((row) => row.userId === actor.userId),
    driver = tx.state.grants.find((row) => row.userId === detail.driverUserId);
  if (
    !tx.state.enabled ||
    !grant ||
    (!grant.roles.some(
      (role) => role === "fleet_manager" || role === "dispatcher",
    ) &&
      !(
        grant.roles.includes("driver") && actor.userId === detail.driverUserId
      )) ||
    !detail.accessGroupIds.some((id) => grant.fleetIds.includes(id)) ||
    !driver?.roles.includes("driver") ||
    !detail.accessGroupIds.some((id) => driver.fleetIds.includes(id))
  )
    throw new FleetError("fleet.dispatch_required", 403);
  if (snapshot.rigPackage) {
    const current = retain
      ? snapshot.rigPackage
      : registry.rigPackages.find((row) => row.id === snapshot.rigPackage!.id);
    if (
      !current ||
      current.archivedAt ||
      JSON.stringify(FleetRigPackageSchema.parse(current)) !==
        JSON.stringify(snapshot.rigPackage) ||
      (current.effectiveUntil &&
        (Date.parse(input.startAt) >= Date.parse(current.effectiveUntil) ||
          (input.plannedEndAt &&
            Date.parse(input.plannedEndAt) >
              Date.parse(current.effectiveUntil)))) ||
      Date.parse(input.startAt) < Date.parse(current.effectiveFrom)
    )
      throw new FleetError("fleet.detail_revision_conflict");
  }
  const person = await tx.client.query(
    "SELECT u.id FROM users u JOIN vendor_people vp ON vp.user_id=u.id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id AND m.org_type='vendor' WHERE u.id=$1 AND vp.vendor_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL",
    [detail.driverUserId, actor.companyId],
  );
  if (!person.rows.length) throw new FleetError("fleet.driver_unavailable");
  const assetIds = [
    detail.vehicleAssetId,
    ...(snapshot.rigPackage?.components.map((row) => row.assetId) ?? []),
  ];
  const assets = await readFleetResourceAssets(
    tx.client,
    actor,
    tx.state,
    assetIds,
  );
  if (assets.some((row) => !["available", "checked_out"].includes(row.status)))
    throw new FleetError("fleet.equipment_unavailable");
  if (
    assets.some(
      (row) =>
        row.status === "checked_out" &&
        row.current_holder_user_id !== detail.driverUserId,
    )
  )
    throw new FleetError("fleet.equipment_custody_conflict");
  const held = await tx.client.query(
    "SELECT id FROM asset_holds WHERE asset_id=ANY($1::uuid[]) AND released_at IS NULL",
    [assetIds],
  );
  if (held.rows.length) throw new FleetError("fleet.equipment_on_hold");
  await tx.client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`fleet-detail-driver:${detail.driverUserId}`],
  );
  const candidate = FleetReservationSchema.parse({
    id: randomUUID(),
    runId: input.runId,
    detailId: detail.id,
    detailVersion: detail.version,
    driverUserId: detail.driverUserId,
    assetIds,
    startAt: input.startAt,
    plannedEndAt: input.plannedEndAt,
    timeZone: input.timeZone,
    state: "reserved",
    actualReleasedAt: null,
    releaseReason: null,
    version: 1,
  });
  const existing = await tx.client.query(
    "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) target_id,id,tool_output FROM assistant_action_audit WHERE target_type='fleet-reservation' ORDER BY target_id,id DESC) latest WHERE tool_output->>'state' IN ('reserved','active') AND (tool_output->>'driverUserId'=$1::text OR tool_output->'assetIds' ?| $2::text[])",
    [detail.driverUserId, assetIds],
  );
  const reservations = existing.rows.map((row) =>
    FleetReservationSchema.parse(row.tool_output),
  );
  if (fleetReservationConflicts(candidate, reservations).length)
    throw new FleetError("fleet.reservation_conflict");
  // V1 work predates reservation receipts. Check both its current aggregate and
  // immutable latest run records, including a driver's work in another company.
  // Only resource identities/status are used; another company's work is never disclosed.
  const legacy = await tx.client.query(
    `SELECT run FROM (
    SELECT value AS run FROM vendors v CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.fleet_ops_state->'runs','[]'::jsonb))
    UNION ALL
    SELECT tool_output AS run FROM (SELECT DISTINCT ON(target_id) target_id,tool_output,id FROM assistant_action_audit
      WHERE target_type='fleet-run' ORDER BY target_id,id DESC) latest
    ) records WHERE run->>'driverUserId'=$1::text OR run->>'vehicleAssetId'=ANY($2::text[]) OR run->>'trailerAssetId'=ANY($2::text[])`,
    [detail.driverUserId, assetIds],
  );
  const latest = new Map<
    string,
    {
      id: string;
      driverUserId: number;
      vehicleAssetId: string;
      trailerAssetId: string | null;
      status: string;
      version: number;
      resourceAssignment?: { version: number };
    }
  >();
  for (const row of [
    ...legacy.rows.map((item) => item.run),
    ...tx.state.runs,
  ]) {
    if (!row || typeof row.id !== "string")
      throw new FleetError("fleet.reservation_conflict");
    const prior = latest.get(row.id);
    if (!prior || prior.version <= row.version) latest.set(row.id, row);
  }
  if (
    [...latest.values()].some(
      (row) =>
        row.id !== candidate.runId &&
        row.resourceAssignment?.version !== 2 &&
        ["dispatched", "acknowledged", "in_progress"].includes(row.status) &&
        (row.driverUserId === candidate.driverUserId ||
          [row.vehicleAssetId, row.trailerAssetId].some(
            (id) => id && candidate.assetIds.includes(id),
          )),
    )
  )
    throw new FleetError("fleet.reservation_conflict");
  const prior = reservations.find((row) => row.runId === candidate.runId);
  if (prior) {
    if (
      prior.detailId !== candidate.detailId ||
      prior.detailVersion !== candidate.detailVersion ||
      prior.startAt !== candidate.startAt ||
      prior.plannedEndAt !== candidate.plannedEndAt
    )
      throw new FleetError("fleet.reservation_revision_conflict");
    return prior;
  }
  registry.reservations.push(candidate);
  await appendFleetResourceRecord(
    tx.client,
    actor,
    "fleet-reservation",
    candidate.id,
    candidate,
  );
  await writeFleetResourceRegistry(tx.client, actor, registry);
  return candidate;
}
export async function releaseFleetReservation(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  input: {
    runId: string;
    reason: string;
    occurredAt: string;
    kind?: "reassignment" | "reschedule" | "replacement";
  },
): Promise<FleetReservation | null> {
  if (actor.readOnly) throw new FleetError("fleet.action_forbidden", 403);
  const run = tx.state.runs.find((row) => row.id === input.runId);
  if (
    !run ||
    run.companyId !== actor.companyId ||
    (run.driverUserId !== actor.userId &&
      !tx.state.grants.some(
        (row) =>
          row.userId === actor.userId &&
          row.roles.some(
            (role) => role === "fleet_manager" || role === "dispatcher",
          ) &&
          row.fleetIds.includes(run.fleetId),
      ))
  )
    throw new FleetError("fleet.action_forbidden", 403);
  const beforeStart =
    input.kind && ["reassignment", "reschedule"].includes(input.kind);
  if (
    beforeStart &&
    (!["draft", "dispatched", "acknowledged"].includes(run.status) ||
      !tx.state.grants.some(
        (grant) =>
          grant.userId === actor.userId &&
          grant.fleetIds.includes(run.fleetId) &&
          grant.roles.some((role) =>
            ["fleet_manager", "dispatcher"].includes(role),
          ),
      ))
  )
    throw new FleetError("fleet.action_forbidden", 403);
  const replacing =
    input.kind === "replacement" &&
    run.status === "in_progress" &&
    run.phase === "paused" &&
    actor.userId === run.driverUserId;
  if (
    !beforeStart &&
    !replacing &&
    !["submitted_for_review", "completed", "cancelled"].includes(run.status)
  )
    throw new FleetError("fleet.run_not_closed");
  if (
    !beforeStart &&
    !replacing &&
    run.status !== "cancelled" &&
    run.resourceAssignment?.returnPolicy === "return_required" &&
    (run.stops.at(-1)?.kind !== "return" ||
      !run.visitedStopIds.includes(run.stops.at(-1)!.id) ||
      run.currentStopId !== null)
  )
    throw new FleetError("fleet.return_required");
  const registry = await readFleetResourceRegistry(tx.client, actor.companyId);
  const reservation = registry.reservations.find(
    (row) => row.runId === input.runId,
  );
  if (!reservation) return null;
  const released = FleetReservationSchema.parse({
    ...reservation,
    state: beforeStart || run.status === "cancelled" ? "cancelled" : "released",
    version: reservation.version + 1,
    actualReleasedAt: input.occurredAt,
    releaseReason: input.reason,
  });
  registry.reservations = registry.reservations.filter(
    (row) => row.id !== reservation.id,
  );
  await appendFleetResourceRecord(
    tx.client,
    actor,
    "fleet-reservation",
    released.id,
    released,
  );
  await writeFleetResourceRegistry(tx.client, actor, registry);
  return released;
}

export async function activateFleetReservation(
  tx: FleetResourcesTransaction,
  actor: FleetActor,
  run: FleetRun,
): Promise<FleetReservation | null> {
  const assignment = run.resourceAssignment;
  if (!assignment) return null;
  if (
    actor.readOnly ||
    actor.companyId !== run.companyId ||
    actor.userId !== run.driverUserId
  )
    throw new FleetError("fleet.action_forbidden", 403);
  const registry = await readFleetResourceRegistry(tx.client, actor.companyId);
  const current = registry.reservations.find(
    (row) => row.id === assignment.reservation.id && row.runId === run.id,
  );
  if (!current || current.version !== assignment.reservation.version)
    throw new FleetError("fleet.reservation_revision_conflict");
  if (current.state === "active") return current;
  const now = new Date().toISOString();
  const candidate = FleetReservationSchema.parse({
    ...current,
    state: "active",
    version: current.version + 1,
    startAt:
      Date.parse(now) < Date.parse(current.startAt) ? now : current.startAt,
    plannedEndAt:
      current.plannedEndAt && Date.parse(current.plannedEndAt) > Date.parse(now)
        ? current.plannedEndAt
        : null,
  });
  const found = await tx.client.query(
    "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) target_id,id,tool_output FROM assistant_action_audit WHERE target_type='fleet-reservation' ORDER BY target_id,id DESC) latest WHERE tool_output->>'state' IN ('reserved','active') AND (tool_output->>'driverUserId'=$1::text OR tool_output->'assetIds' ?| $2::text[])",
    [current.driverUserId, current.assetIds],
  );
  if (
    fleetReservationConflicts(
      candidate,
      found.rows.map((row) => FleetReservationSchema.parse(row.tool_output)),
    ).length
  )
    throw new FleetError("fleet.reservation_conflict");
  registry.reservations = registry.reservations.map((row) =>
    row.id === candidate.id ? candidate : row,
  );
  await appendFleetResourceRecord(
    tx.client,
    actor,
    "fleet-reservation",
    candidate.id,
    candidate,
  );
  await writeFleetResourceRegistry(tx.client, actor, registry);
  return candidate;
}
