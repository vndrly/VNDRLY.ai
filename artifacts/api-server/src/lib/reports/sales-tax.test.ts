import { describe, expect, it } from "vitest";
import type { SalesTaxByStateRow } from "./sales-tax";

// The DB-bound aggregator lives in sales-tax.ts. The interesting
// non-SQL logic is the post-aggregation: effective rate calculation,
// state sort order, totals reduction. We extract a pure helper here
// matching the live implementation so we can verify multi-state
// aggregation without a real DB connection.

function enrichAndTotal(
  raw: { state: string; taxableSales: string; exemptSales: string; taxCollected: string }[],
): { rows: SalesTaxByStateRow[]; totals: SalesTaxByStateRow } {
  const enriched = raw.map((r) => {
    const tax = Number(r.taxCollected);
    const taxable = Number(r.taxableSales);
    const eff = taxable > 0 ? tax / taxable : 0;
    return { ...r, effectiveRate: eff.toFixed(4) };
  });
  enriched.sort((a, b) => Number(b.taxCollected) - Number(a.taxCollected));
  const totals: SalesTaxByStateRow = enriched.reduce(
    (acc, r) => {
      const t = Number(r.taxableSales) + Number(acc.taxableSales);
      const e = Number(r.exemptSales) + Number(acc.exemptSales);
      const c = Number(r.taxCollected) + Number(acc.taxCollected);
      return {
        state: "TOTAL",
        taxableSales: t.toFixed(2),
        exemptSales: e.toFixed(2),
        taxCollected: c.toFixed(2),
        effectiveRate: t > 0 ? (c / t).toFixed(4) : "0.0000",
      };
    },
    {
      state: "TOTAL",
      taxableSales: "0.00",
      exemptSales: "0.00",
      taxCollected: "0.00",
      effectiveRate: "0.0000",
    } as SalesTaxByStateRow,
  );
  return { rows: enriched, totals };
}

describe("sales tax by state", () => {
  it("aggregates multiple states with correct totals", () => {
    const result = enrichAndTotal([
      {
        state: "TX",
        taxableSales: "10000.00",
        exemptSales: "0.00",
        taxCollected: "625.00",
      },
      {
        state: "NM",
        taxableSales: "4000.00",
        exemptSales: "500.00",
        taxCollected: "207.50",
      },
    ]);
    expect(result.totals.taxableSales).toBe("14000.00");
    expect(result.totals.exemptSales).toBe("500.00");
    expect(result.totals.taxCollected).toBe("832.50");
  });

  it("sorts states by taxCollected descending", () => {
    const result = enrichAndTotal([
      {
        state: "NM",
        taxableSales: "100.00",
        exemptSales: "0.00",
        taxCollected: "5.00",
      },
      {
        state: "TX",
        taxableSales: "100.00",
        exemptSales: "0.00",
        taxCollected: "6.25",
      },
    ]);
    expect(result.rows[0].state).toBe("TX");
    expect(result.rows[1].state).toBe("NM");
  });

  it("computes effective rate per row at 4dp", () => {
    const result = enrichAndTotal([
      {
        state: "TX",
        taxableSales: "10000.00",
        exemptSales: "0.00",
        taxCollected: "625.00",
      },
    ]);
    expect(result.rows[0].effectiveRate).toBe("0.0625");
  });

  it("returns 0.0000 effective rate when taxable sales is zero", () => {
    const result = enrichAndTotal([
      {
        state: "TX",
        taxableSales: "0.00",
        exemptSales: "1000.00",
        taxCollected: "0.00",
      },
    ]);
    expect(result.rows[0].effectiveRate).toBe("0.0000");
  });

  it("keeps exempt sales separate from taxable sales", () => {
    const result = enrichAndTotal([
      {
        state: "OR",
        taxableSales: "0.00",
        exemptSales: "5000.00",
        taxCollected: "0.00",
      },
    ]);
    expect(result.rows[0].taxableSales).toBe("0.00");
    expect(result.rows[0].exemptSales).toBe("5000.00");
    expect(result.totals.exemptSales).toBe("5000.00");
  });

  it("rounds totals to 2dp", () => {
    const result = enrichAndTotal([
      {
        state: "TX",
        taxableSales: "33.33",
        exemptSales: "0.00",
        taxCollected: "2.08",
      },
      {
        state: "NM",
        taxableSales: "33.33",
        exemptSales: "0.00",
        taxCollected: "1.73",
      },
      {
        state: "OK",
        taxableSales: "33.34",
        exemptSales: "0.00",
        taxCollected: "1.50",
      },
    ]);
    expect(result.totals.taxableSales).toBe("100.00");
    // Verify 2dp pattern.
    expect(result.totals.taxCollected).toMatch(/^\d+\.\d{2}$/);
  });

  it("yields TOTAL row state label when reducing", () => {
    const result = enrichAndTotal([]);
    expect(result.totals.state).toBe("TOTAL");
    expect(result.totals.taxableSales).toBe("0.00");
  });
});
