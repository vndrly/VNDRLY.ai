import { describe, expect, it } from "vitest";
import {
  rollupK,
  thresholdForYear,
  K_THRESHOLDS_BY_YEAR,
  K_TXN_COUNT_THRESHOLD_PRE_2024,
} from "./k1099";

const baseRaw = {
  vendorId: 1,
  vendorName: "Acme",
  federalTaxId: "12-3456789",
  vendorAddress: "1 Main",
  payerPartnerId: 10,
  payerPartnerName: "TPSO",
  payerEin: "98-7654321",
  payerAddress: "100 Big",
};

describe("thresholdForYear", () => {
  it("matches the published phase-in", () => {
    expect(thresholdForYear(2023)).toBe(20000);
    expect(thresholdForYear(2024)).toBe(5000);
    expect(thresholdForYear(2025)).toBe(2500);
    expect(thresholdForYear(2026)).toBe(600);
    expect(thresholdForYear(2030)).toBe(600);
  });

  it("constant table is consistent with the function", () => {
    for (const [yr, t] of Object.entries(K_THRESHOLDS_BY_YEAR)) {
      expect(thresholdForYear(Number(yr))).toBe(t);
    }
  });
});

describe("rollupK — threshold + monthly breakout", () => {
  it("excludes vendors below the threshold", () => {
    const out = rollupK(
      [{ ...baseRaw, monthIdx: 0, amount: "599.99", txnCount: 1 }],
      600,
      2026,
    );
    expect(out).toEqual([]);
  });

  it("includes vendors at or above threshold", () => {
    const out = rollupK(
      [{ ...baseRaw, monthIdx: 0, amount: "600.00", txnCount: 1 }],
      600,
      2026,
    );
    expect(out).toHaveLength(1);
    expect(out[0].grossAmount).toBe("600.00");
    expect(out[0].monthly[0]).toBe("600.00");
    expect(out[0].transactionCount).toBe(1);
  });

  it("aggregates monthly totals across the year", () => {
    const out = rollupK(
      [
        { ...baseRaw, monthIdx: 0, amount: "300", txnCount: 5 },
        { ...baseRaw, monthIdx: 5, amount: "700", txnCount: 9 },
        { ...baseRaw, monthIdx: 11, amount: "1200", txnCount: 12 },
      ],
      600,
      2026,
    );
    expect(out).toHaveLength(1);
    expect(out[0].grossAmount).toBe("2200.00");
    expect(out[0].transactionCount).toBe(26);
    expect(out[0].monthly[0]).toBe("300.00");
    expect(out[0].monthly[5]).toBe("700.00");
    expect(out[0].monthly[11]).toBe("1200.00");
    expect(out[0].monthly[1]).toBe("0.00");
  });

  it("enforces the pre-2024 200-txn rule", () => {
    const out = rollupK(
      [{ ...baseRaw, monthIdx: 0, amount: "25000", txnCount: 50 }],
      20000,
      2023,
    );
    expect(out).toEqual([]);
    expect(K_TXN_COUNT_THRESHOLD_PRE_2024).toBe(200);
  });

  it("waives the txn-count rule for 2024+", () => {
    const out = rollupK(
      [{ ...baseRaw, monthIdx: 0, amount: "6000", txnCount: 5 }],
      5000,
      2024,
    );
    expect(out).toHaveLength(1);
  });

  it("records the month the running YTD total first crossed the threshold", () => {
    // Jan 200, Feb 250, Mar 200 → YTD reaches the 600 threshold in Mar (idx 2).
    const out = rollupK(
      [
        { ...baseRaw, monthIdx: 0, amount: "200", txnCount: 1 },
        { ...baseRaw, monthIdx: 1, amount: "250", txnCount: 1 },
        { ...baseRaw, monthIdx: 2, amount: "200", txnCount: 1 },
      ],
      600,
      2026,
    );
    expect(out).toHaveLength(1);
    expect(out[0].crossedAtMonthIdx).toBe(2);
  });

  it("treats reaching the threshold exactly as crossing", () => {
    // Single Feb payment of 600 hits the threshold in month index 1.
    const out = rollupK(
      [{ ...baseRaw, monthIdx: 1, amount: "600", txnCount: 1 }],
      600,
      2026,
    );
    expect(out[0].crossedAtMonthIdx).toBe(1);
  });

  it("uses the correct cross-over month for the 2024 $5000 threshold", () => {
    // 2024 threshold is $5000. Reach it across Jan–Apr.
    const out = rollupK(
      [
        { ...baseRaw, monthIdx: 0, amount: "1000", txnCount: 1 },
        { ...baseRaw, monthIdx: 1, amount: "2000", txnCount: 1 },
        { ...baseRaw, monthIdx: 2, amount: "1500", txnCount: 1 },
        { ...baseRaw, monthIdx: 3, amount: "800", txnCount: 1 },
      ],
      5000,
      2024,
    );
    expect(out).toHaveLength(1);
    expect(out[0].crossedAtMonthIdx).toBe(3);
  });

  it("flags shared-EIN warning across distinct vendors", () => {
    const out = rollupK(
      [
        { ...baseRaw, monthIdx: 0, amount: "1000", txnCount: 1 },
        {
          ...baseRaw,
          vendorId: 2,
          vendorName: "Other",
          monthIdx: 0,
          amount: "1000",
          txnCount: 1,
        },
      ],
      600,
      2026,
    );
    expect(out.every((r) => r.sharedEinWarning)).toBe(true);
  });
});
