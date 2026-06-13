import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/reports/sales-tax", () => ({
  salesTaxByState: vi.fn(async () => ({
    rows: [
      { state: "TX", taxableSales: "100.00", exemptSales: "0.00", taxCollected: "8.25", effectiveRate: "0.0825" },
      { state: "NM", taxableSales: "50.00", exemptSales: "0.00", taxCollected: "2.00", effectiveRate: "0.0400" },
    ],
    totals: {
      state: "TOTAL",
      taxableSales: "150.00",
      exemptSales: "0.00",
      taxCollected: "10.25",
      effectiveRate: "0.0683",
    },
  })),
}));

import { buildDeepLink, periodToReportUrlRange, REPORT_CARD_IDS } from "./deep-links";
import { parsePageContext } from "./page-context";
import { runDataTool } from "./data-tools";
import { resolvePeriod } from "../lib/reports/period";

describe("parsePageContext", () => {
  it("returns undefined for missing or invalid input", () => {
    expect(parsePageContext(undefined)).toBeUndefined();
    expect(parsePageContext(null)).toBeUndefined();
    expect(parsePageContext("")).toBeUndefined();
    expect(parsePageContext({ path: "" })).toBeUndefined();
  });

  it("parses path and optional entity id", () => {
    expect(parsePageContext({ path: "/reports" })).toEqual({ path: "/reports" });
    expect(parsePageContext({ path: "/tickets/42", entityId: 42 })).toEqual({
      path: "/tickets/42",
      entityId: 42,
    });
  });
});

describe("buildDeepLink — reports card deep links", () => {
  it("builds sales tax YTD URL with optional state highlight", () => {
    const url = buildDeepLink({
      screen: "reports",
      reportCard: "salesTaxByState",
      reportPreset: "ytd",
      highlightState: "tx",
    });
    expect(typeof url).toBe("string");
    const parsed = new URL(`http://local${url as string}`);
    expect(parsed.pathname).toBe("/reports");
    expect(parsed.searchParams.get("card")).toBe("salesTaxByState");
    expect(parsed.searchParams.get("state")).toBe("TX");
    expect(parsed.searchParams.get("periodStart")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.searchParams.get("periodEnd")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects unknown report cards", () => {
    const url = buildDeepLink({ screen: "reports", reportCard: "notReal" });
    expect(url).toEqual(expect.objectContaining({ error: expect.stringContaining("Unknown report card") }));
  });

  it("whitelisted report cards match ReportsPage cardId values", () => {
    expect(REPORT_CARD_IDS).toContain("salesTaxByState");
  });
});

describe("periodToReportUrlRange", () => {
  it("uses inclusive end date for URL params", () => {
    const period = resolvePeriod({ preset: "ytd" }, new Date("2026-06-15T12:00:00.000Z"));
    const range = periodToReportUrlRange(period);
    expect(range.periodStart).toBe("2026-01-01");
    expect(range.periodEnd).toBe("2026-06-15");
  });
});

describe("runDataTool — sales tax and 1099 metrics", () => {
  it("query_sales_tax_by_state scopes to partner and filters state", async () => {
    const out = JSON.parse(
      await runDataTool(
        "query_sales_tax_by_state",
        { preset: "ytd", state: "TX" },
        { role: "partner", partnerId: 1, userId: 1 } as never,
      ),
    );
    expect(out.rowCount).toBe(1);
    expect(out.rows[0].state).toBe("TX");
    expect(out.preset).toBe("ytd");
  });

  it("query_nec1099_summary blocks field employees", async () => {
    const out = JSON.parse(
      await runDataTool("query_nec1099_summary", { year: 2026 }, { role: "field_employee", userId: 1 } as never),
    );
    expect(out.error).toMatch(/not available to field employees/);
  });
});
