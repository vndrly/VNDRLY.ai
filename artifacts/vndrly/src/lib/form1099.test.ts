import { describe, expect, it } from "vitest";
import {
  plannedFormFor,
  routeLine,
  sumByForm,
  type IncomeCategory,
  type PaymentLite,
} from "./form1099";

// These tests lock in the contract between the client-side helper and
// the backend reports in artifacts/api-server/src/lib/reports/{nec,misc,k}1099.ts.
// If the backend filters change (e.g. a new excluded payment method, or
// MISC categories start being routed off MISC when paid by card), one
// of these cases should fail and force a deliberate update on both sides.

describe("plannedFormFor", () => {
  it("maps NEC category to nec form", () => {
    expect(plannedFormFor("nec")).toBe("nec");
  });

  it("maps each MISC category 1:1 to its misc_* form code", () => {
    const miscCategories: IncomeCategory[] = [
      "misc_rents",
      "misc_royalties",
      "misc_other_income",
      "misc_prizes_awards",
      "misc_medical_health",
      "misc_attorney",
    ];
    for (const c of miscCategories) {
      expect(plannedFormFor(c)).toBe(c);
    }
  });

  it("maps k_third_party_network to the k form", () => {
    expect(plannedFormFor("k_third_party_network")).toBe("k");
  });

  it("maps none to none", () => {
    expect(plannedFormFor("none")).toBe("none");
  });
});

describe("routeLine — NEC lines", () => {
  it("routes a NEC line paid entirely in cash to NEC only", () => {
    const payments: PaymentLite[] = [{ amount: "500.00", method: "cash" }];
    const r = routeLine({
      lineAmount: "500.00",
      category: "nec",
      invoiceTotal: "500.00",
      payments,
    });
    expect(r.plannedForm).toBe("nec");
    expect(r.effective).toEqual([{ form: "nec", amount: 500 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("routes a NEC line paid entirely by check / ACH / other non-card to NEC only", () => {
    for (const method of ["check", "ach", "wire", "other"]) {
      const r = routeLine({
        lineAmount: "1000.00",
        category: "nec",
        invoiceTotal: "1000.00",
        payments: [{ amount: "1000.00", method }],
      });
      expect(r.effective).toEqual([{ form: "nec", amount: 1000 }]);
      expect(r.isFlagged).toBe(false);
    }
  });

  it("routes a NEC line fully paid by credit card entirely to K", () => {
    const r = routeLine({
      lineAmount: "750.00",
      category: "nec",
      invoiceTotal: "750.00",
      payments: [{ amount: "750.00", method: "credit_card" }],
    });
    expect(r.plannedForm).toBe("nec");
    expect(r.effective).toEqual([{ form: "k", amount: 750 }]);
    expect(r.isFlagged).toBe(true);
  });

  it("splits a NEC line proportionally between NEC and K when partially paid by credit card", () => {
    // $1000 invoice with one $1000 NEC line; $400 credit-card + $600 cash.
    // Card share = 0.4 → K=$400, NEC=$600.
    const r = routeLine({
      lineAmount: "1000.00",
      category: "nec",
      invoiceTotal: "1000.00",
      payments: [
        { amount: "400.00", method: "credit_card" },
        { amount: "600.00", method: "cash" },
      ],
    });
    expect(r.plannedForm).toBe("nec");
    expect(r.effective).toEqual([
      { form: "nec", amount: 600 },
      { form: "k", amount: 400 },
    ]);
    expect(r.isFlagged).toBe(true);
  });

  it("treats unpaid portions of a NEC line as still on NEC", () => {
    // $1000 invoice, $300 paid by cash, $700 unpaid.
    // ccFraction = 0, necFraction = 1 → entire line on NEC.
    const r = routeLine({
      lineAmount: "1000.00",
      category: "nec",
      invoiceTotal: "1000.00",
      payments: [{ amount: "300.00", method: "cash" }],
    });
    expect(r.effective).toEqual([{ form: "nec", amount: 1000 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("treats fully unpaid NEC lines as still on NEC", () => {
    const r = routeLine({
      lineAmount: "1000.00",
      category: "nec",
      invoiceTotal: "1000.00",
      payments: [],
    });
    expect(r.plannedForm).toBe("nec");
    expect(r.effective).toEqual([{ form: "nec", amount: 1000 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("ignores payments with non-positive amounts when computing card share", () => {
    const r = routeLine({
      lineAmount: "100.00",
      category: "nec",
      invoiceTotal: "100.00",
      payments: [
        { amount: "0.00", method: "credit_card" },
        { amount: "-50.00", method: "credit_card" },
        { amount: "100.00", method: "cash" },
      ],
    });
    expect(r.effective).toEqual([{ form: "nec", amount: 100 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("caps overpayments via LEAST(payment,total)/total scaling", () => {
    // Simulates the backend's LEAST(payment, total)/total cap. $1000
    // invoice with $800 cc + $400 cash = $1200 paid; scale = 1000/1200,
    // ccPortion = 666.67 → ccFraction ≈ 0.667.
    const r = routeLine({
      lineAmount: "1000.00",
      category: "nec",
      invoiceTotal: "1000.00",
      payments: [
        { amount: "800.00", method: "credit_card" },
        { amount: "400.00", method: "cash" },
      ],
    });
    // necAmt = round2(1000 * (1 - 0.6666...)) = 333.33; kAmt = 1000 - 333.33 = 666.67.
    expect(r.effective).toEqual([
      { form: "nec", amount: 333.33 },
      { form: "k", amount: 666.67 },
    ]);
    expect(r.isFlagged).toBe(true);
  });
});

describe("routeLine — non-NEC lines never split on payment method", () => {
  it.each([
    "misc_rents",
    "misc_royalties",
    "misc_other_income",
    "misc_prizes_awards",
    "misc_medical_health",
    "misc_attorney",
  ] as const satisfies readonly IncomeCategory[])(
    "%s line paid by credit card stays on its MISC box",
    (category) => {
      const r = routeLine({
        lineAmount: "500.00",
        category,
        invoiceTotal: "500.00",
        payments: [{ amount: "500.00", method: "credit_card" }],
      });
      expect(r.plannedForm).toBe(category);
      expect(r.effective).toEqual([{ form: category, amount: 500 }]);
      expect(r.isFlagged).toBe(false);
    },
  );

  it("k_third_party_network line routes to K regardless of payment method", () => {
    const r = routeLine({
      lineAmount: "250.00",
      category: "k_third_party_network",
      invoiceTotal: "250.00",
      payments: [{ amount: "250.00", method: "cash" }],
    });
    expect(r.plannedForm).toBe("k");
    expect(r.effective).toEqual([{ form: "k", amount: 250 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("none line stays on none even when paid by credit card", () => {
    const r = routeLine({
      lineAmount: "100.00",
      category: "none",
      invoiceTotal: "100.00",
      payments: [{ amount: "100.00", method: "credit_card" }],
    });
    expect(r.plannedForm).toBe("none");
    expect(r.effective).toEqual([{ form: "none", amount: 100 }]);
    expect(r.isFlagged).toBe(false);
  });
});

describe("routeLine — edge cases", () => {
  it("returns no allocations when the line amount is zero", () => {
    const r = routeLine({
      lineAmount: 0,
      category: "nec",
      invoiceTotal: "100.00",
      payments: [{ amount: "100.00", method: "credit_card" }],
    });
    expect(r.plannedForm).toBe("nec");
    expect(r.effective).toEqual([]);
    expect(r.isFlagged).toBe(false);
  });

  it("falls back to NEC-only when the invoice total is zero or negative", () => {
    for (const invoiceTotal of ["0.00", "-1.00"]) {
      const r = routeLine({
        lineAmount: "50.00",
        category: "nec",
        invoiceTotal,
        payments: [{ amount: "50.00", method: "credit_card" }],
      });
      expect(r.effective).toEqual([{ form: "nec", amount: 50 }]);
      expect(r.isFlagged).toBe(false);
    }
  });

  it("accepts numeric and string amount inputs interchangeably", () => {
    const a = routeLine({
      lineAmount: 100,
      category: "nec",
      invoiceTotal: 100,
      payments: [{ amount: 25, method: "credit_card" }, { amount: 75, method: "cash" }],
    });
    const b = routeLine({
      lineAmount: "100",
      category: "nec",
      invoiceTotal: "100",
      payments: [
        { amount: "25", method: "credit_card" },
        { amount: "75", method: "cash" },
      ],
    });
    expect(a).toEqual(b);
  });

  it("treats malformed numeric strings as zero (graceful no-op rather than NaN)", () => {
    const r = routeLine({
      lineAmount: "not-a-number",
      category: "nec",
      invoiceTotal: "100.00",
      payments: [{ amount: "abc", method: "credit_card" }],
    });
    // lineAmount=0 → empty allocations.
    expect(r.effective).toEqual([]);
  });
});

describe("routeLine — rounding invariant", () => {
  // For NEC lines the helper guarantees nec + k allocations sum exactly
  // to the line amount (no penny drift), even with awkward fractions.
  const cases: Array<{
    lineAmount: string;
    invoiceTotal: string;
    payments: PaymentLite[];
  }> = [
    {
      lineAmount: "100.00",
      invoiceTotal: "300.00",
      payments: [
        { amount: "100.00", method: "credit_card" },
        { amount: "200.00", method: "cash" },
      ],
    },
    {
      lineAmount: "33.33",
      invoiceTotal: "100.00",
      payments: [
        { amount: "33.33", method: "credit_card" },
        { amount: "66.67", method: "cash" },
      ],
    },
    {
      lineAmount: "999.99",
      invoiceTotal: "999.99",
      payments: [
        { amount: "333.33", method: "credit_card" },
        { amount: "666.66", method: "cash" },
      ],
    },
    {
      lineAmount: "12.34",
      invoiceTotal: "37.00",
      payments: [
        { amount: "11.00", method: "credit_card" },
        { amount: "26.00", method: "cash" },
      ],
    },
    // Single-line invoice paid entirely by credit card.
    {
      lineAmount: "1234.56",
      invoiceTotal: "1234.56",
      payments: [{ amount: "1234.56", method: "credit_card" }],
    },
  ];

  for (const c of cases) {
    it(`nec + k sum to line amount ${c.lineAmount}`, () => {
      const r = routeLine({
        category: "nec",
        lineAmount: c.lineAmount,
        invoiceTotal: c.invoiceTotal,
        payments: c.payments,
      });
      const total = r.effective.reduce((s, a) => s + a.amount, 0);
      // Use a tight epsilon to confirm exact equality after round2.
      expect(Math.abs(total - Number(c.lineAmount))).toBeLessThan(0.005);
    });
  }
});

describe("sumByForm", () => {
  it("returns all-zero buckets for an empty allocation list", () => {
    const totals = sumByForm([]);
    expect(totals).toEqual({
      nec: 0,
      misc_rents: 0,
      misc_royalties: 0,
      misc_other_income: 0,
      misc_prizes_awards: 0,
      misc_medical_health: 0,
      misc_attorney: 0,
      k: 0,
      none: 0,
    });
  });

  it("aggregates allocations by form code", () => {
    const totals = sumByForm([
      { form: "nec", amount: 100 },
      { form: "nec", amount: 50.55 },
      { form: "k", amount: 25 },
      { form: "misc_rents", amount: 600 },
      { form: "none", amount: 10 },
    ]);
    expect(totals.nec).toBe(150.55);
    expect(totals.k).toBe(25);
    expect(totals.misc_rents).toBe(600);
    expect(totals.none).toBe(10);
    expect(totals.misc_attorney).toBe(0);
  });

  it("rounds running totals to 2 decimals to avoid float drift", () => {
    const totals = sumByForm([
      { form: "nec", amount: 0.1 },
      { form: "nec", amount: 0.2 },
    ]);
    expect(totals.nec).toBe(0.3);
  });
});
