import { describe, expect, it } from "vitest";
import { rollupMisc, MISC_BOX_THRESHOLDS } from "./misc1099";

const baseRaw = {
  vendorId: 1,
  vendorName: "Acme Rentals LLC",
  federalTaxId: "12-3456789",
  vendorAddress: "1 Main St",
  payerPartnerId: 10,
  payerPartnerName: "Energy Corp",
  payerEin: "98-7654321",
  payerAddress: "100 Big Ave",
};

describe("rollupMisc — box thresholds", () => {
  it("excludes a Box 1 (rents) total below $600", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "599.99" },
    ]);
    expect(out).toEqual([]);
  });

  it("includes a Box 1 (rents) total at or above $600", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "600.00" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].box1Rents).toBe("600.00");
    expect(out[0].totalReportable).toBe("600.00");
  });

  it("uses the lower $10 threshold for royalties (Box 2)", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_royalties", amount: "10.00" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].box2Royalties).toBe("10.00");
  });

  it("zeroes a sub-threshold box but keeps the row when another box clears", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "700.00" },
      { ...baseRaw, incomeCategory: "misc_royalties", amount: "5.00" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].box1Rents).toBe("700.00");
    expect(out[0].box2Royalties).toBe("0.00");
    expect(out[0].totalReportable).toBe("700.00");
  });

  it("aggregates multiple boxes into totalReportable", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "1000.00" },
      { ...baseRaw, incomeCategory: "misc_other_income", amount: "750.00" },
      { ...baseRaw, incomeCategory: "misc_attorney", amount: "1234.56" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].totalReportable).toBe("2984.56");
  });

  it("constants match IRS thresholds for tax year 2026", () => {
    expect(MISC_BOX_THRESHOLDS.rents).toBe(600);
    expect(MISC_BOX_THRESHOLDS.royalties).toBe(10);
    expect(MISC_BOX_THRESHOLDS.medicalHealth).toBe(600);
    expect(MISC_BOX_THRESHOLDS.attorney).toBe(600);
  });
});

describe("rollupMisc — multi-vendor / multi-payer grouping", () => {
  it("creates a separate row per (vendor, payer) pair", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "800" },
      {
        ...baseRaw,
        vendorId: 2,
        vendorName: "Other LLC",
        federalTaxId: "11-1111111",
        incomeCategory: "misc_rents",
        amount: "900",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.vendorId).sort()).toEqual([1, 2]);
  });

  it("flags shared-EIN warning across distinct vendors", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "800" },
      {
        ...baseRaw,
        vendorId: 2,
        vendorName: "Other LLC",
        incomeCategory: "misc_rents",
        amount: "900",
      },
    ]);
    expect(out.every((r) => r.sharedEinWarning)).toBe(true);
  });

  it("does not flag null EINs as shared", () => {
    const out = rollupMisc([
      {
        ...baseRaw,
        federalTaxId: null,
        incomeCategory: "misc_rents",
        amount: "800",
      },
      {
        ...baseRaw,
        vendorId: 2,
        federalTaxId: null,
        incomeCategory: "misc_rents",
        amount: "900",
      },
    ]);
    expect(out.every((r) => !r.sharedEinWarning)).toBe(true);
  });

  it("sorts highest totalReportable first", () => {
    const out = rollupMisc([
      { ...baseRaw, incomeCategory: "misc_rents", amount: "700" },
      {
        ...baseRaw,
        vendorId: 2,
        vendorName: "Big LLC",
        federalTaxId: "22-2222222",
        incomeCategory: "misc_rents",
        amount: "9000",
      },
    ]);
    expect(out[0].vendorId).toBe(2);
    expect(out[1].vendorId).toBe(1);
  });
});
