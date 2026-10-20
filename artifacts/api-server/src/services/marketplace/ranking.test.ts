import { describe, expect, it } from "vitest";
import { rankMarketplaceVendors, type RankingCandidate } from "./ranking";

const candidate = (
  vendorId: number,
  patch: Partial<RankingCandidate> = {},
): RankingCandidate => ({
  vendorId,
  vendorName: `Vendor ${vendorId}`,
  capabilityId: vendorId,
  capabilityName: "Gate crews",
  canonicalServiceId: 5,
  matchExplanation: "Controlled entry",
  offer: {
    id: vendorId,
    unitPrice: 75,
    unit: "hour",
    currency: "USD",
    capacity: 2,
    available: true,
    commercialConditions: null,
  },
  rating: null,
  reviewCount: 0,
  safety: null,
  completedJobs: 0,
  onTimeRate: null,
  priorPartnerJobs: 0,
  complianceCurrent: true,
  relationshipStatus: null,
  eligibility: {
    eligible: true,
    reasonCodes: [],
    facts: {
      distanceMiles: 20,
      radiusMiles: 100,
      availableCapacity: 2,
      requiredCapacity: 1,
      missingCredentials: [],
    },
    internalEvidence: { notes: "private" },
  },
  ...patch,
});

describe("transparent marketplace ranking", () => {
  it("keeps an ineligible high performer below eligible vendors and preserves reason codes and radius", () => {
    const outside = candidate(1, {
      rating: 5,
      reviewCount: 10,
      safety: {
        score: 100,
        source: "VNDRLY",
        refreshedAt: "2026-10-18T00:00:00.000Z",
        reasons: [],
      },
    });
    outside.eligibility = {
      ...outside.eligibility,
      eligible: false,
      reasonCodes: ["OUT_OF_SERVICE_AREA"],
      facts: { ...outside.eligibility.facts, distanceMiles: 101 },
    };
    const rows = rankMarketplaceVendors({
      candidates: [outside, candidate(2)],
    });
    expect(rows.map((x) => x.vendorId)).toEqual([2, 1]);
    expect(rows[1]).toMatchObject({
      offerable: false,
      eligibility: {
        reasonCodes: ["OUT_OF_SERVICE_AREA"],
        facts: { distanceMiles: 101, radiusMiles: 100 },
      },
    });
    expect(rows[1].eligibility).not.toHaveProperty("internalEvidence");
  });
  it("leaves missing evidence null and explains named factors", () => {
    const [row] = rankMarketplaceVendors({ candidates: [candidate(1)] });
    expect(row).toMatchObject({
      rating: null,
      safety: null,
      ratingStatus: "not_yet_rated",
      safetyStatus: "not_yet_rated",
    });
    expect(row.factors.find((x) => x.name === "rating")).toMatchObject({
      normalized: null,
      status: "not_yet_rated",
    });
    expect(row.factors.find((x) => x.name === "safety")).toMatchObject({
      normalized: null,
    });
    expect(
      row.factors.find((x) => x.name === "distance")?.explanation,
    ).toContain("20");
    expect(row.factors.find((x) => x.name === "price")?.explanation).toContain(
      "USD",
    );
  });
  it("supports partner sorting and configured weights with deterministic vendor ties", () => {
    const near = candidate(2);
    const cheap = candidate(1, {
      offer: { ...near.offer, id: 1, unitPrice: 25 },
    });
    cheap.eligibility = {
      ...cheap.eligibility,
      facts: { ...cheap.eligibility.facts, distanceMiles: 80 },
    };
    expect(
      rankMarketplaceVendors({
        candidates: [near, cheap],
        sort: "distance",
      }).map((x) => x.vendorId),
    ).toEqual([2, 1]);
    expect(
      rankMarketplaceVendors({ candidates: [near, cheap], sort: "price" }).map(
        (x) => x.vendorId,
      ),
    ).toEqual([1, 2]);
    expect(
      rankMarketplaceVendors({
        candidates: [near, cheap],
        weights: { price: 0, distance: 100 },
      }).map((x) => x.vendorId),
    ).toEqual([2, 1]);
    expect(
      rankMarketplaceVendors({ candidates: [candidate(4), candidate(3)] }).map(
        (x) => x.vendorId,
      ),
    ).toEqual([3, 4]);
  });
  it("does not imply prices on different units or currencies are comparable", () => {
    const hourly = candidate(1);
    const daily = candidate(2, {
      offer: { ...hourly.offer, id: 2, unitPrice: 1, unit: "day" },
    });
    const rows = rankMarketplaceVendors({ candidates: [hourly, daily] });
    expect(
      rows.every(
        (x) => x.factors.find((f) => f.name === "price")?.normalized === null,
      ),
    ).toBe(true);
    expect(rows[0].factors.find((f) => f.name === "price")?.status).toBe(
      "not_comparable",
    );
  });
});
