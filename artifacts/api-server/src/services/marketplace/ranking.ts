import type { EligibilityResult } from "./eligibility";

export const RANKING_FACTORS = [
  "price",
  "rating",
  "safety",
  "history",
  "onTime",
  "distance",
  "availability",
  "priorExperience",
] as const;
export type RankingFactorName = (typeof RANKING_FACTORS)[number];
export type MarketplaceSort = "recommended" | RankingFactorName;
export interface RankingCandidate {
  vendorId: number;
  vendorName: string;
  capabilityId: number;
  capabilityName: string;
  canonicalServiceId: number;
  matchExplanation: string;
  offer: {
    id: number;
    unitPrice: number;
    unit: string;
    currency: string;
    capacity: number;
    available: boolean;
    commercialConditions: string | null;
  };
  rating: number | null;
  reviewCount: number;
  safety: { score: number; source: string; refreshedAt: string; reasons: string[] } | null;
  completedJobs: number;
  onTimeRate: number | null;
  priorPartnerJobs: number;
  complianceCurrent: boolean;
  relationshipStatus: string | null;
  eligibility: EligibilityResult;
}
export interface RankingFactor {
  name: RankingFactorName;
  normalized: number | null;
  weight: number;
  status: "available" | "not_yet_rated" | "not_comparable";
  explanation: string;
}
export type RankedVendor = Omit<RankingCandidate, "eligibility"> & {
  eligibility: Omit<EligibilityResult, "internalEvidence">;
  offerable: boolean;
  ratingStatus: "rated" | "not_yet_rated";
  safetyStatus: "rated" | "not_yet_rated";
  weightedScore: number;
  factors: RankingFactor[];
};
export interface RankInput {
  candidates: RankingCandidate[];
  sort?: MarketplaceSort;
  weights?: Partial<Record<RankingFactorName, number>>;
}
const DEFAULT_WEIGHTS: Record<RankingFactorName, number> = {
  price: 15,
  rating: 20,
  safety: 20,
  history: 10,
  onTime: 10,
  distance: 10,
  availability: 10,
  priorExperience: 5,
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Ranking consumes completed server eligibility decisions; scores can never change them. */
export function rankMarketplaceVendors(input: RankInput): RankedVendor[] {
  const weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  for (const name of RANKING_FACTORS)
    if (
      !Number.isFinite(weights[name]) ||
      weights[name] < 0 ||
      weights[name] > 100
    )
      throw new Error("Invalid marketplace ranking weight");
  // A day rate and an hourly rate cannot form one price comparison without a scope estimate.
  const bases = new Set(
    input.candidates.map((row) => `${row.offer.currency}/${row.offer.unit}`),
  );
  const minPrice = Math.min(
    ...input.candidates.map((row) => row.offer.unitPrice),
  );
  const maxPrice = Math.max(
    ...input.candidates.map((row) => row.offer.unitPrice),
  );
  const maxHistory = Math.max(
    1,
    ...input.candidates.map((row) => row.completedJobs),
  );
  const maxPrior = Math.max(
    1,
    ...input.candidates.map((row) => row.priorPartnerJobs),
  );
  const maxDistance = Math.max(
    1,
    ...input.candidates.map((row) => row.eligibility.facts.distanceMiles ?? 0),
  );
  const totalWeight = RANKING_FACTORS.reduce(
    (sum, name) => sum + weights[name],
    0,
  );
  const rows = input.candidates.map((row): RankedVendor => {
    const distance = row.eligibility.facts.distanceMiles;
    const factors: RankingFactor[] = [];
    const factor = (
      name: RankingFactorName,
      value: number | null,
      explanation: string,
      status?: RankingFactor["status"],
    ) => {
      factors.push({
        name,
        normalized: value === null ? null : clamp(value),
        weight: weights[name],
        status: status ?? (value === null ? "not_yet_rated" : "available"),
        explanation,
      });
    };
    factor(
      "price",
      bases.size === 1
        ? maxPrice === minPrice
          ? 1
          : (maxPrice - row.offer.unitPrice) / (maxPrice - minPrice)
        : null,
      `Price: ${row.offer.unitPrice} ${row.offer.currency}/${row.offer.unit}${bases.size > 1 ? "; different currency or unit, not comparable" : "; lower comparable rate ranks higher"}`,
      bases.size > 1 ? "not_comparable" : "available",
    );
    factor(
      "rating",
      row.rating === null ? null : row.rating / 5,
      row.rating === null
        ? "Rating: not yet rated"
        : `Rating: ${row.rating}/5 from ${row.reviewCount} completed-ticket reviews`,
    );
    factor(
      "safety",
      row.safety === null ? null : row.safety.score / 100,
      row.safety === null
        ? "Safety: not yet rated"
        : `Safety: ${row.safety.score}/100; ${row.safety.source}; refreshed ${row.safety.refreshedAt}`,
    );
    factor(
      "history",
      row.completedJobs / maxHistory,
      `History: ${row.completedJobs} relevant completed jobs with this partner`,
    );
    factor(
      "onTime",
      row.onTimeRate,
      row.onTimeRate === null
        ? "On-time performance: no scheduled completed jobs"
        : `On-time performance: ${Math.round(row.onTimeRate * 100)}%`,
    );
    factor(
      "distance",
      distance === null ? null : 1 - distance / maxDistance,
      distance === null
        ? "Distance: saved coordinates unavailable"
        : `Distance: ${distance} miles; coverage radius ${row.eligibility.facts.radiusMiles} miles`,
    );
    factor(
      "availability",
      row.offer.available ? 1 : 0,
      `Availability: ${row.offer.available ? "available" : "unavailable"}; capacity ${row.eligibility.facts.availableCapacity}`,
    );
    factor(
      "priorExperience",
      row.priorPartnerJobs / maxPrior,
      `Prior experience: ${row.priorPartnerJobs} completed jobs with this partner`,
    );
    // Unknown factors stay null. The fixed configured denominator avoids rewarding sparse evidence.
    const weightedScore =
      totalWeight === 0
        ? 0
        : factors.reduce(
            (sum, f) =>
              sum + (f.normalized === null ? 0 : f.normalized * f.weight),
            0,
          ) / totalWeight;
    // Deliberate positive projection: never spread stored candidates or internal eligibility evidence.
    return {
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      capabilityId: row.capabilityId,
      capabilityName: row.capabilityName,
      canonicalServiceId: row.canonicalServiceId,
      matchExplanation: row.matchExplanation,
      offer: {
        id: row.offer.id,
        unitPrice: row.offer.unitPrice,
        unit: row.offer.unit,
        currency: row.offer.currency,
        capacity: row.offer.capacity,
        available: row.offer.available,
        commercialConditions: row.offer.commercialConditions,
      },
      rating: row.rating,
      reviewCount: row.reviewCount,
      safety:
        row.safety === null
          ? null
          : {
              score: row.safety.score,
              source: row.safety.source,
              refreshedAt: row.safety.refreshedAt,
              reasons: [...row.safety.reasons],
            },
      completedJobs: row.completedJobs,
      onTimeRate: row.onTimeRate,
      priorPartnerJobs: row.priorPartnerJobs,
      complianceCurrent: row.complianceCurrent,
      relationshipStatus: row.relationshipStatus,
      eligibility: {
        eligible: row.eligibility.eligible,
        reasonCodes: [...row.eligibility.reasonCodes],
        facts: {
          distanceMiles: distance,
          radiusMiles: row.eligibility.facts.radiusMiles,
          availableCapacity: row.eligibility.facts.availableCapacity,
          requiredCapacity: row.eligibility.facts.requiredCapacity,
          missingCredentials: [...row.eligibility.facts.missingCredentials],
        },
      },
      offerable: row.eligibility.eligible,
      ratingStatus: row.rating === null ? "not_yet_rated" : "rated",
      safetyStatus: row.safety === null ? "not_yet_rated" : "rated",
      weightedScore,
      factors,
    };
  });
  const sort = input.sort ?? "recommended";
  return rows.sort((a, b) => {
    const eligible =
      Number(b.eligibility.eligible) - Number(a.eligibility.eligible);
    if (eligible) return eligible;
    if (sort !== "recommended") {
      const av = a.factors.find((f) => f.name === sort)!.normalized;
      const bv = b.factors.find((f) => f.name === sort)!.normalized;
      const order =
        Number(bv !== null) - Number(av !== null) || (bv ?? 0) - (av ?? 0);
      if (order) return order;
    } else if (a.weightedScore !== b.weightedScore)
      return b.weightedScore - a.weightedScore;
    return a.vendorId - b.vendorId || a.capabilityId - b.capabilityId;
  });
}
