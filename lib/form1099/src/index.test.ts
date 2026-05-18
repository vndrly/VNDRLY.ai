import { describe, expect, it } from "vitest";
import {
  FORMS_1099,
  form1099Label,
  plannedFormFor,
  routeLine,
  sumByForm,
} from "./index";

describe("plannedFormFor", () => {
  it("maps k_third_party_network → k", () => {
    expect(plannedFormFor("k_third_party_network")).toBe("k");
  });

  it("maps each non-k category 1:1 to its form code", () => {
    for (const f of FORMS_1099) {
      if (f === "k") continue;
      expect(plannedFormFor(f)).toBe(f);
    }
  });
});

describe("routeLine", () => {
  it("non-NEC categories route entirely to their planned form", () => {
    const r = routeLine({
      lineAmount: "100.00",
      category: "misc_attorney",
      invoiceTotal: "100.00",
      payments: [{ amount: "100.00", method: "credit_card" }],
    });
    expect(r.plannedForm).toBe("misc_attorney");
    expect(r.effective).toEqual([{ form: "misc_attorney", amount: 100 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("NEC line fully cash-paid stays NEC", () => {
    const r = routeLine({
      lineAmount: "200.00",
      category: "nec",
      invoiceTotal: "200.00",
      payments: [{ amount: "200.00", method: "ach" }],
    });
    expect(r.effective).toEqual([{ form: "nec", amount: 200 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("NEC line fully credit-card-paid routes entirely to K", () => {
    const r = routeLine({
      lineAmount: "150.00",
      category: "nec",
      invoiceTotal: "150.00",
      payments: [{ amount: "150.00", method: "credit_card" }],
    });
    expect(r.effective).toEqual([{ form: "k", amount: 150 }]);
    expect(r.isFlagged).toBe(true);
  });

  it("NEC line half on card, half cash splits proportionally", () => {
    const r = routeLine({
      lineAmount: "100.00",
      category: "nec",
      invoiceTotal: "100.00",
      payments: [
        { amount: "50.00", method: "credit_card" },
        { amount: "50.00", method: "ach" },
      ],
    });
    expect(r.effective).toEqual([
      { form: "nec", amount: 50 },
      { form: "k", amount: 50 },
    ]);
    expect(r.isFlagged).toBe(true);
  });

  it("unpaid NEC line is projected to NEC (default settlement is non-card)", () => {
    const r = routeLine({
      lineAmount: "100.00",
      category: "nec",
      invoiceTotal: "100.00",
      payments: [],
    });
    expect(r.effective).toEqual([{ form: "nec", amount: 100 }]);
    expect(r.isFlagged).toBe(false);
  });

  it("zero-amount line routes to nothing", () => {
    const r = routeLine({
      lineAmount: 0,
      category: "nec",
      invoiceTotal: "100.00",
      payments: [],
    });
    expect(r.effective).toEqual([]);
  });

  it("over-paid NEC invoice doesn't double-route the credit-card portion", () => {
    // Invoice total $100, but $80 cc + $80 cash = $160 paid (e.g. an
    // accidental double-pay). The cap matches the backend's
    // LEAST(payment, total) / total filter.
    const r = routeLine({
      lineAmount: "100.00",
      category: "nec",
      invoiceTotal: "100.00",
      payments: [
        { amount: "80.00", method: "credit_card" },
        { amount: "80.00", method: "ach" },
      ],
    });
    const total = r.effective.reduce((s, a) => s + a.amount, 0);
    expect(total).toBe(100);
  });
});

describe("sumByForm", () => {
  it("aggregates allocations into per-form totals", () => {
    const totals = sumByForm([
      { form: "nec", amount: 60 },
      { form: "nec", amount: 40 },
      { form: "k", amount: 25 },
      { form: "misc_rents", amount: 10.5 },
    ]);
    expect(totals.nec).toBe(100);
    expect(totals.k).toBe(25);
    expect(totals.misc_rents).toBe(10.5);
    expect(totals.misc_royalties).toBe(0);
  });
});

describe("form1099Label", () => {
  it("returns IRS-style English labels with box numbers", () => {
    expect(form1099Label("nec")).toBe("1099-NEC");
    expect(form1099Label("misc_rents")).toBe("1099-MISC Box 1");
    expect(form1099Label("misc_attorney")).toBe("1099-MISC Box 10");
    expect(form1099Label("k")).toBe("1099-K");
    expect(form1099Label("none")).toBe("Not reportable");
  });

  it("returns Spanish labels when requested", () => {
    expect(form1099Label("misc_rents", "es")).toBe("1099-MISC casilla 1");
    expect(form1099Label("none", "es")).toBe("No declarable");
  });

  it("falls back to the raw code on unknown values", () => {
    expect(form1099Label("not_a_form")).toBe("not_a_form");
  });
});
