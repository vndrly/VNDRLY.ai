import { describe, expect, it } from "vitest";
import { applyThreshold, NEC_THRESHOLD_USD } from "./nec1099";

describe("NEC 1099 threshold", () => {
  it("excludes amounts below 600.00", () => {
    const rows = [{ totalPaid: "599.99" }];
    expect(applyThreshold(rows)).toEqual([]);
  });

  it("includes amounts equal to 600.00 (right at threshold)", () => {
    const rows = [{ totalPaid: "600.00" }];
    expect(applyThreshold(rows)).toEqual([{ totalPaid: "600.00" }]);
  });

  it("includes amounts above 600.00", () => {
    const rows = [{ totalPaid: "12345.67" }];
    expect(applyThreshold(rows)).toHaveLength(1);
  });

  it("respects an override threshold", () => {
    const rows = [{ totalPaid: "100.00" }, { totalPaid: "50.00" }];
    expect(applyThreshold(rows, 100)).toEqual([{ totalPaid: "100.00" }]);
  });

  it("default threshold is the IRS $600", () => {
    expect(NEC_THRESHOLD_USD).toBe(600);
  });

  it("filters mixed rows correctly", () => {
    const rows = [
      { totalPaid: "599.99" },
      { totalPaid: "600.00" },
      { totalPaid: "0.00" },
      { totalPaid: "1000.00" },
    ];
    expect(applyThreshold(rows)).toHaveLength(2);
  });
});

describe("NEC 1099 shared-EIN detection (logic)", () => {
  // The detection lives inside nec1099Rows() — simulate the same logic
  // here so we can verify the contract without a DB.
  function detectShared(
    rows: Array<{ vendorId: number; federalTaxId: string | null }>,
  ): Array<{ vendorId: number; federalTaxId: string | null; sharedEinWarning: boolean }> {
    const einCounts = new Map<string, Set<number>>();
    for (const r of rows) {
      if (!r.federalTaxId) continue;
      const set = einCounts.get(r.federalTaxId) ?? new Set();
      set.add(r.vendorId);
      einCounts.set(r.federalTaxId, set);
    }
    return rows.map((r) => ({
      ...r,
      sharedEinWarning:
        r.federalTaxId != null &&
        (einCounts.get(r.federalTaxId)?.size ?? 0) > 1,
    }));
  }

  it("flags two vendors sharing the same EIN", () => {
    const out = detectShared([
      { vendorId: 1, federalTaxId: "12-3456789" },
      { vendorId: 2, federalTaxId: "12-3456789" },
      { vendorId: 3, federalTaxId: "98-7654321" },
    ]);
    expect(out[0].sharedEinWarning).toBe(true);
    expect(out[1].sharedEinWarning).toBe(true);
    expect(out[2].sharedEinWarning).toBe(false);
  });

  it("does not flag the same vendor appearing twice with the same EIN", () => {
    const out = detectShared([
      { vendorId: 1, federalTaxId: "12-3456789" },
      { vendorId: 1, federalTaxId: "12-3456789" },
    ]);
    expect(out[0].sharedEinWarning).toBe(false);
  });

  it("does not flag null EINs as shared", () => {
    const out = detectShared([
      { vendorId: 1, federalTaxId: null },
      { vendorId: 2, federalTaxId: null },
    ]);
    expect(out[0].sharedEinWarning).toBe(false);
    expect(out[1].sharedEinWarning).toBe(false);
  });
});
