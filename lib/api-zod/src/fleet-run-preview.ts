import type { FleetActionInput, FleetRun } from "./fleet";

export type FleetRunPreview = {
  unsynced: true;
  baseVersion: number;
  expectedVersion: number;
  status: FleetRun["status"];
  phase: string | null;
  currentStopId: string | null;
  visitedStopIds: string[];
  allowedActions: FleetRun["allowedActions"];
  loads: {
    id: string;
    pickupStopId: string;
    commodity: string;
    quantity: number;
    unit: string;
    manifestReference: string;
    delivered: boolean;
  }[];
};

/** Proposed local facts only. This does not verify grants/readiness, execute
 * anything, fabricate accepted timestamps, or modify the canonical record.
 * Sync must retain the original assignment/account and stop on any conflict.
 */
export function previewFleetRunActions(
  base: FleetRun,
  actions: readonly FleetActionInput[],
): FleetRunPreview {
  const next: FleetRunPreview = {
    unsynced: true,
    baseVersion: base.version,
    expectedVersion: base.version,
    status: base.status,
    phase: base.phase,
    currentStopId: base.currentStopId,
    visitedStopIds: [...base.visitedStopIds],
    allowedActions: [],
    loads: base.loads.map((load) => ({
      id: load.id,
      pickupStopId: load.pickupStopId,
      commodity: load.commodity,
      quantity: load.quantity,
      unit: load.unit,
      manifestReference: load.manifestReference,
      delivered: Boolean(load.deliveredAt),
    })),
  };
  let pausedFrom = base.pausedFromPhase;
  const inspection = base.inspections.at(-1);
  let passed =
    inspection?.outcome === "passed" &&
    inspection.driverUserId === base.driverUserId &&
    inspection.vehicleAssetId === base.vehicleAssetId &&
    inspection.trailerAssetId === base.trailerAssetId;
  let defect = inspection?.outcome === "defect_reported";
  const meters = base.records
    .filter(
      (r) => r.kind === "meter" && r.vehicleAssetId === base.vehicleAssetId,
    )
    .map((r) => ({ unit: r.unit, reading: r.reading! }));
  const available = (): FleetRun["allowedActions"] => {
    if (next.status === "dispatched") return ["acknowledge"];
    if (next.status === "acknowledged")
      return [
        "inspect",
        "record_meter",
        ...(passed &&
        !defect &&
        meters.some((m) => ["miles", "kilometers"].includes(m.unit))
          ? ["start" as const]
          : []),
      ];
    if (next.status !== "in_progress") return [];
    if (next.phase === "paused") return ["resume"];
    const result: FleetRun["allowedActions"] = [
      "pause",
      "record_fuel",
      "record_meter",
    ];
    if (!next.currentStopId && next.visitedStopIds.length < base.stops.length)
      result.push("arrive_stop");
    if (next.currentStopId) {
      result.push("depart_stop");
      const stop = base.stops.find((s) => s.id === next.currentStopId);
      if (stop?.kind === "pickup") result.push("record_load");
      if (stop?.kind === "delivery") result.push("record_delivery");
    }
    if (
      !next.currentStopId &&
      next.visitedStopIds.length === base.stops.length &&
      next.loads.length &&
      next.loads.every((l) => l.delivered) &&
      meters.filter((m) => ["miles", "kilometers"].includes(m.unit)).length >= 2
    )
      result.push("submit_closeout");
    return result;
  };
  const fail = () => {
    throw new Error(
      "This queued Fleet action conflicts with the proposed sequence. Read the canonical run; never silently rebase.",
    );
  };
  for (const action of actions) {
    if (
      action.expectedVersion !== next.expectedVersion ||
      !available().includes(action.action)
    )
      fail();
    if (action.action === "acknowledge") next.status = "acknowledged";
    else if (action.action === "inspect") {
      if (!action.inspectionOutcome || !action.notes) fail();
      passed = action.inspectionOutcome === "passed";
      defect ||= action.inspectionOutcome === "defect_reported";
    } else if (action.action === "record_meter") {
      if (
        action.reading === undefined ||
        !action.notes ||
        !["miles", "kilometers", "engine_hours"].includes(action.unit ?? "")
      )
        fail();
      const previous = meters.filter((m) => m.unit === action.unit).at(-1);
      const distance = meters.find((m) =>
        ["miles", "kilometers"].includes(m.unit),
      );
      if (
        (previous && action.reading! < previous.reading) ||
        (distance &&
          ["miles", "kilometers"].includes(action.unit!) &&
          distance.unit !== action.unit)
      )
        fail();
      meters.push({ unit: action.unit!, reading: action.reading! });
    } else if (action.action === "record_fuel") {
      if (
        !action.quantity ||
        !action.notes ||
        !["gallons", "liters"].includes(action.unit ?? "")
      )
        fail();
    } else if (action.action === "start") {
      next.status = "in_progress";
      next.phase = "traveling_to_pickup";
    } else if (action.action === "pause") {
      if (!action.reason) fail();
      pausedFrom = next.phase;
      next.phase = "paused";
    } else if (action.action === "resume") {
      next.phase = pausedFrom;
      pausedFrom = null;
    } else if (action.action === "arrive_stop") {
      const stop = base.stops[next.visitedStopIds.length];
      if (!stop || stop.id !== action.stopId) fail();
      next.currentStopId = stop.id;
      next.phase =
        stop.kind === "pickup"
          ? "at_pickup"
          : stop.kind === "delivery"
            ? "at_delivery"
            : "returning";
    } else if (action.action === "record_load") {
      if (
        !action.loadId ||
        !action.commodity ||
        !action.quantity ||
        !action.unit ||
        !action.manifestReference ||
        next.loads.some((l) => l.id === action.loadId)
      )
        fail();
      next.loads.push({
        id: action.loadId!,
        pickupStopId: next.currentStopId!,
        commodity: action.commodity!,
        quantity: action.quantity!,
        unit: action.unit!,
        manifestReference: action.manifestReference!,
        delivered: false,
      });
      next.phase = "loading";
    } else if (action.action === "record_delivery") {
      const load = next.loads.find((l) => l.id === action.loadId);
      if (!load || load.delivered || !action.deliveryReference) fail();
      load!.delivered = true;
      next.phase = "unloading";
    } else if (action.action === "depart_stop") {
      const stop = base.stops.find((s) => s.id === next.currentStopId);
      if (!stop || stop.id !== action.stopId) fail();
      if (
        (stop!.kind === "pickup" &&
          !next.loads.some((l) => l.pickupStopId === stop!.id)) ||
        (stop!.kind === "delivery" && next.loads.some((l) => !l.delivered))
      )
        fail();
      next.visitedStopIds.push(stop!.id);
      next.currentStopId = null;
      next.phase = "traveling_to_next_stop";
    } else if (action.action === "submit_closeout") {
      next.status = "submitted_for_review";
      next.phase = null;
    } else fail();
    next.expectedVersion++;
  }
  next.allowedActions = available();
  return next;
}
