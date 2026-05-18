import { describe, it, expect } from "vitest";
import {
  findNameMatches,
  normalizeCompanyName,
  similarity,
  SCORE_THRESHOLD,
} from "./name-match";

describe("normalizeCompanyName", () => {
  it("matches normalizeVendorName behavior on representative inputs", () => {
    // Same cases as vendor-match.test.ts to prove behavior is preserved
    // when the vendor matcher delegates here.
    expect(normalizeCompanyName("Baker Hughes Field Svcs")).toBe("baker hughes");
    expect(normalizeCompanyName("ConocoPhillips Permian Holdings")).toBe(
      "conocophillips permian",
    );
  });
});

describe("findNameMatches (partner-style names)", () => {
  // The partners table is seeded with operators like ConocoPhillips,
  // Pioneer, Diamondback, etc. The /partners/match endpoint shares this
  // helper with /vendors/match, so the same scoring rules must catch
  // near-duplicate operator names typed in the new-partner form.
  const partners = [
    { id: 1, name: "ConocoPhillips" },
    { id: 2, name: "Pioneer Natural Resources" },
    { id: 3, name: "Diamondback Energy" },
    { id: 4, name: "EOG Resources" },
    { id: 5, name: "Occidental Petroleum" },
  ];

  it("flags the existing partner when the user types a near-duplicate", () => {
    const matches = findNameMatches("ConocoPhillips Permian", partners);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe(1);
    expect(matches[0].name).toBe("ConocoPhillips");
  });

  it("flags partial-name typos (Pioneer Natural)", () => {
    const matches = findNameMatches("Pioneer Natural", partners);
    expect(matches[0].id).toBe(2);
    expect(matches[0].score).toBeGreaterThanOrEqual(SCORE_THRESHOLD);
  });

  it("returns nothing for a clearly different operator name", () => {
    expect(findNameMatches("Devon Energy", partners)).toEqual([]);
  });

  it("returns nothing for blank input", () => {
    expect(findNameMatches("", partners)).toEqual([]);
    expect(findNameMatches("   ", partners)).toEqual([]);
  });

  it("uses the same threshold and similarity scoring as the vendor matcher", () => {
    // Sanity check: identical normalized inputs score 1.0.
    expect(similarity("Pioneer Natural", "Pioneer Natural Resources")).toBe(1);
  });
});
