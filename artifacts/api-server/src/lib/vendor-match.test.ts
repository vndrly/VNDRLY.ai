import { describe, it, expect } from "vitest";
import {
  findVendorMatches,
  normalizeVendorName,
  similarity,
  SCORE_THRESHOLD,
} from "./vendor-match";

describe("normalizeVendorName", () => {
  it("lowercases and strips corporate suffixes", () => {
    expect(normalizeVendorName("Baker Hughes Field Svcs")).toBe("baker hughes");
    expect(normalizeVendorName("Stallion Infrastructure Services")).toBe(
      "stallion infrastructure",
    );
    expect(normalizeVendorName("U.S. Silica Holdings")).toBe("u s silica");
  });

  it("strips punctuation but keeps meaningful tokens", () => {
    expect(normalizeVendorName("Liberty Energy / ProFrac")).toBe(
      "liberty energy profrac",
    );
    expect(normalizeVendorName("NOV (National Oilwell Varco)")).toBe(
      "nov national oilwell varco",
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeVendorName("   ")).toBe("");
    expect(normalizeVendorName("")).toBe("");
  });
});

describe("similarity", () => {
  it("scores identical normalized names at 1.0", () => {
    expect(similarity("Baker Hughes", "Baker Hughes Field Svcs")).toBe(1);
  });

  it("scores known dedupe-script duplicate pairs above the threshold", () => {
    const pairs: Array<[string, string]> = [
      ["Baker Hughes", "Baker Hughes Field Svcs"],
      ["ChampionX", "ChampionX / Newpark"],
      ["Liberty Energy", "Liberty Energy / ProFrac"],
      ["NOV Inc.", "NOV (National Oilwell Varco)"],
      ["Patterson-UTI Energy", "Patterson-UTI / Precision"],
      ["U.S. Silica Holdings", "U.S. Silica / Hi-Crush"],
      ["Stallion Infrastructure Services", "Stallion Infrastructure"],
    ];
    for (const [a, b] of pairs) {
      const s = similarity(a, b);
      expect(s, `expected ${a} ~ ${b} above threshold; got ${s}`).toBeGreaterThanOrEqual(
        SCORE_THRESHOLD,
      );
    }
  });

  it("does NOT match clearly unrelated vendors", () => {
    const lowPairs: Array<[string, string]> = [
      ["Baker Hughes", "Halliburton"],
      ["Liberty Energy", "Schlumberger"],
      ["ChampionX", "Weatherford"],
    ];
    for (const [a, b] of lowPairs) {
      const s = similarity(a, b);
      expect(s, `expected ${a} ≁ ${b} below threshold; got ${s}`).toBeLessThan(
        SCORE_THRESHOLD,
      );
    }
  });

  it("handles a one-character typo as a near-match", () => {
    expect(similarity("Halliburton", "Haliburton")).toBeGreaterThanOrEqual(
      SCORE_THRESHOLD,
    );
  });
});

describe("findVendorMatches", () => {
  const vendors = [
    { id: 1, name: "Baker Hughes" },
    { id: 2, name: "Halliburton" },
    { id: 3, name: "Schlumberger" },
    { id: 4, name: "ChampionX" },
    { id: 5, name: "Liberty Energy" },
  ];

  it("finds the existing vendor when the user types a near-duplicate", () => {
    const matches = findVendorMatches("Baker Hughes Field Services", vendors);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe(1);
    expect(matches[0].name).toBe("Baker Hughes");
  });

  it("returns matches sorted by score descending", () => {
    const matches = findVendorMatches("Liberty Energy / ProFrac", vendors);
    expect(matches[0].id).toBe(5);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("returns no matches for completely novel names", () => {
    expect(findVendorMatches("Acme Wireline", vendors)).toEqual([]);
  });

  it("returns no matches when query is blank or only suffixes", () => {
    expect(findVendorMatches("", vendors)).toEqual([]);
    expect(findVendorMatches("Inc LLC Services", vendors)).toEqual([]);
  });

  it("respects the limit option", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `Acme Services ${i + 1}`,
    }));
    const matches = findVendorMatches("Acme Services", many, { limit: 3 });
    expect(matches.length).toBe(3);
  });
});
