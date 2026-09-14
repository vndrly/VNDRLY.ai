import type { AssetAlias, AssetOwner, AssetRecord } from "./assets";

export type GateObservationSource = "camera" | "gatekeeper" | "geofence" | "driver";
export type GateDirection = "entry" | "exit";
export type ReconciliationState = "observed" | "reconciled" | "needs_supervisor_review";
export type SourcedFact<T> = { value: T; source: "observed" | "supplied_later" };

export type GateObservation = {
  direction: GateDirection;
  source: GateObservationSource;
  observedAt: Date;
  observedArrivalAt: Date | null;
  observedDepartureAt: Date | null;
  plate?: string;
  plateState?: string;
  state: ReconciliationState;
  facts: Record<string, SourcedFact<string>>;
  conflictReason?: string;
};

export type ReconciledGateObservation = GateObservation & {
  completedAt?: Date;
  completedByGatekeeperUserId?: number;
};

const clean = (value?: string) => value?.trim() || undefined;
const normalizePlate = (value?: string) => clean(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeState = (value?: string) => clean(value)?.toUpperCase();

export function observeGateCrossing(input: {
  direction: GateDirection;
  at: Date;
  source: GateObservationSource;
  plate?: string;
  plateState?: string;
}): GateObservation {
  const plate = clean(input.plate);
  const plateState = normalizeState(input.plateState);
  return {
    direction: input.direction,
    source: input.source,
    observedAt: input.at,
    observedArrivalAt: input.direction === "entry" ? input.at : null,
    observedDepartureAt: input.direction === "exit" ? input.at : null,
    ...(plate ? { plate } : {}),
    ...(plateState ? { plateState } : {}),
    state: "observed",
    facts: {
      ...(plate ? { plate: { value: plate, source: "observed" as const } } : {}),
      ...(plateState ? { plateState: { value: plateState, source: "observed" as const } } : {}),
    },
  };
}

export function reconcileVisit(
  observation: GateObservation,
  supplied: { plate?: string; plateState?: string; driverName?: string; company?: string },
): ReconciledGateObservation {
  const suppliedPlate = clean(supplied.plate);
  const suppliedState = normalizeState(supplied.plateState);
  if (observation.plate && suppliedPlate && (
    normalizePlate(observation.plate) !== normalizePlate(suppliedPlate) ||
    (observation.plateState && suppliedState && normalizeState(observation.plateState) !== suppliedState)
  )) {
    return { ...observation, state: "needs_supervisor_review", conflictReason: "gate.conflicting_vehicle_identity" };
  }

  const plate = observation.plate ?? suppliedPlate;
  const plateState = observation.plateState ?? suppliedState;
  const facts = { ...observation.facts };
  if (!observation.plate && suppliedPlate) facts.plate = { value: suppliedPlate, source: "supplied_later" };
  if (!observation.plateState && suppliedState) facts.plateState = { value: suppliedState, source: "supplied_later" };
  if (clean(supplied.driverName)) facts.driverName = { value: clean(supplied.driverName)!, source: "supplied_later" };
  if (clean(supplied.company)) facts.company = { value: clean(supplied.company)!, source: "supplied_later" };
  if (!plate || !facts.driverName || !facts.company) {
    return {
      ...observation,
      ...(plate ? { plate } : {}),
      ...(plateState ? { plateState } : {}),
      facts,
      state: "needs_supervisor_review",
      conflictReason: "gate.unresolved_identity",
    };
  }
  return { ...observation, plate, ...(plateState ? { plateState } : {}), facts, state: "reconciled" };
}

export function completeRetrospectiveVisit(
  observation: GateObservation,
  supplied: { plate?: string; plateState?: string; driverName?: string; company?: string },
  completion: { at: Date; gatekeeperUserId: number },
): ReconciledGateObservation {
  const reconciled = reconcileVisit(observation, supplied);
  return reconciled.state === "reconciled"
    ? { ...reconciled, completedAt: completion.at, completedByGatekeeperUserId: completion.gatekeeperUserId }
    : reconciled;
}

type AssetMatcher = {
  findAsset(alias: AssetAlias): Promise<AssetRecord | null>;
  findOrCreateProvisional(input: { identifier: AssetAlias; responsibleOwner: AssetOwner }): Promise<AssetRecord>;
};

export async function matchVehicleByPlate(input: {
  plate: string;
  plateState: string;
  owner: AssetOwner;
  assets: AssetMatcher;
}): Promise<AssetRecord> {
  const identifier: AssetAlias = {
    kind: "plate",
    value: input.plate,
    jurisdiction: input.plateState.toUpperCase(),
  };
  return (await input.assets.findAsset(identifier)) ?? input.assets.findOrCreateProvisional({ identifier, responsibleOwner: input.owner });
}
