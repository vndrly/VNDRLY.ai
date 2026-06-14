import { describe, expect, it } from "vitest";
import {
  aggregateSpendByLineType,
  normalizeLineTypeForAnalytics,
} from "@workspace/db/line-types";

describe("normalizeLineTypeForAnalytics", () => {
  it("merges labor variants into labor", () => {
    expect(normalizeLineTypeForAnalytics("labor_regular")).toBe("labor");
    expect(normalizeLineTypeForAnalytics("Labor Overtime")).toBe("labor");
    expect(normalizeLineTypeForAnalytics("labor")).toBe("labor");
  });

  it("merges material aliases into materials", () => {
    expect(normalizeLineTypeForAnalytics("material")).toBe("materials");
    expect(normalizeLineTypeForAnalytics("Materials")).toBe("materials");
    expect(normalizeLineTypeForAnalytics("parts")).toBe("materials");
  });

  it("maps unknown types like fuel into other", () => {
    expect(normalizeLineTypeForAnalytics("fuel")).toBe("other");
    expect(normalizeLineTypeForAnalytics("misc")).toBe("other");
  });
});

describe("aggregateSpendByLineType", () => {
  it("combines duplicate buckets and sorts by total desc", () => {
    const result = aggregateSpendByLineType([
      { type: "material", total: 50 },
      { type: "materials", total: 25 },
      { type: "labor_regular", total: 100 },
      { type: "labor_overtime", total: 40 },
      { type: "equipment", total: 200 },
    ]);

    expect(result).toEqual([
      { type: "equipment", label: "Equipment", total: 200 },
      { type: "labor", label: "Labor", total: 140 },
      { type: "materials", label: "Materials", total: 75 },
    ]);
  });

  it("rolls small slices below 2% into other", () => {
    const result = aggregateSpendByLineType(
      [
        { type: "equipment", total: 820_000 },
        { type: "labor_regular", total: 417_000 },
        { type: "mileage", total: 844 },
        { type: "fuel", total: 55_130 },
      ],
      { smallSliceThreshold: 0.02 },
    );

    const mileage = result.find((row) => row.type === "mileage");
    const other = result.find((row) => row.type === "other");
    expect(mileage).toBeUndefined();
    expect(other?.total).toBe(55_130 + 844);
    expect(result[0]?.type).toBe("equipment");
  });
});
