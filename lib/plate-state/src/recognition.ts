/** A recognition is an observation, never an identity or an admission decision. */
export interface VehicleAppearance {
  color: string | null;
  bodyType: string | null;
  make: string | null;
  model: string | null;
  markings: string[];
}

export interface GateRecognition {
  plate: string | null;
  state: string | null;
  plateConfidence: number | null;
  stateConfidence: number | null;
  provider?: string;
  modelVersion?: string;
  elapsedMs?: number;
  reviewRequired?: true;
  appearance?: VehicleAppearance | null;
  alternatives?: string[];
  quality?: "readable" | "unreadable" | "multiple_vehicles";
}

/** Do not match similar strings or visually similar vehicles to a visit. */
export function recognitionMatchesVisit(
  candidate: Pick<GateRecognition, "plate" | "state">,
  visit: { vehiclePlate?: string | null; plateState?: string | null },
): boolean {
  const compact = (value: string | null | undefined) => value?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "";
  return Boolean(candidate.plate && compact(candidate.plate) === compact(visit.vehiclePlate) &&
    (!candidate.state || !visit.plateState || candidate.state === visit.plateState));
}

export function vehicleAppearanceSummary(appearance?: VehicleAppearance | null): string {
  if (!appearance) return "";
  return [appearance.color, appearance.make, appearance.model, appearance.bodyType, ...appearance.markings].filter(Boolean).join(" · ");
}
