export type GeofenceSample = {
  at: Date;
  distanceMeters: number;
  accuracyMeters: number;
};

export type DirectionalCrossing =
  | { kind: "none" }
  | { kind: "entry" | "exit"; crossedAt: Date; confirmedAt: Date };

type StableSide = "inside" | "outside" | "uncertain";

function side(sample: GeofenceSample, radiusMeters: number): StableSide {
  if (!Number.isFinite(sample.distanceMeters) || !Number.isFinite(sample.accuracyMeters)) return "uncertain";
  const accuracy = Math.max(0, sample.accuracyMeters);
  if (sample.distanceMeters + accuracy <= radiusMeters) return "inside";
  if (sample.distanceMeters - accuracy >= radiusMeters) return "outside";
  return "uncertain";
}

export function evaluateDirectionalCrossing(
  samples: readonly GeofenceSample[],
  options: { radiusMeters: number; presenceMs?: number },
): DirectionalCrossing {
  const presenceMs = Math.max(1_000, options.presenceMs ?? 8_000);
  if (samples.length < 2 || !Number.isFinite(options.radiusMeters) || options.radiusMeters <= 0) return { kind: "none" };
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  let lastStable: { value: Exclude<StableSide, "uncertain">; index: number } | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const current = side(ordered[index], options.radiusMeters);
    if (current === "uncertain") continue;
    if (lastStable && lastStable.value !== current) {
      const candidate = ordered[index];
      const tail = ordered.slice(index);
      const targetRemainedStable = tail.every((sample) => {
        const sampleSide = side(sample, options.radiusMeters);
        return sampleSide === current || sampleSide === "uncertain";
      });
      const confirmedAt = ordered[ordered.length - 1].at;
      if (targetRemainedStable && confirmedAt.getTime() - candidate.at.getTime() >= presenceMs) {
        return {
          kind: current === "inside" ? "entry" : "exit",
          crossedAt: candidate.at,
          confirmedAt,
        };
      }
    }
    lastStable = { value: current, index };
  }
  return { kind: "none" };
}

export function crossingDeduplicationKey(input: {
  driverUserId: number;
  vehicleAssetId: string | null;
  siteLocationId: number;
  direction: "entry" | "exit";
  crossedAt: Date;
  conflictWindowMs?: number;
}): string {
  const windowMs = Math.max(10_000, input.conflictWindowMs ?? 120_000);
  const bucket = Math.floor(input.crossedAt.getTime() / windowMs);
  return [input.driverUserId, input.vehicleAssetId ?? "no-vehicle", input.siteLocationId, input.direction, bucket].join(":");
}
