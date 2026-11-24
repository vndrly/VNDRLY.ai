import { describe, expect, it } from "vitest";
import { askVRevenueComparison } from "./askv-revenue-visual";

const receipt = (preset: string, rows: unknown[], role = "vendor") => ({
  name: "query_revenue_summary", input: { preset, breakdown: "work_type" },
  output: JSON.stringify({ preset, role, breakdown: "work_type", periodLabel: preset === "last_year" ? "2025" : "2026 YTD", rows }),
});

describe("AskV revenue comparison", () => {
  it("calculates the chart from matching tool receipts, including missing categories", () => {
    expect(askVRevenueComparison([
      receipt("last_year", [{ workTypeName: "Hauling", amount: "100.50" }]),
      receipt("ytd", [{ workTypeName: "Inspection", amount: "25.00" }, { workTypeName: "Hauling", amount: "40.00" }]),
    ])).toMatchObject({ years: ["2025", "2026 YTD"], totals: [100.5, 65], rows: [
      { label: "Hauling", previous: 100.5, current: 40 },
      { label: "Inspection", previous: 0, current: 25 },
    ] });
  });

  it("does not chart mismatched scopes or invalid values", () => {
    expect(askVRevenueComparison([receipt("last_year", []), receipt("ytd", [], "partner")])).toBeNull();
    expect(askVRevenueComparison([receipt("last_year", []), receipt("ytd", [{ workTypeName: "Bad", amount: "NaN" }])])).toBeNull();
  });

  it("labels a site follow-up using site amounts", () => {
    const calls = ["last_year", "ytd"].map((preset, index) => ({
      name: "query_revenue_summary", input: { preset, breakdown: "site" },
      output: JSON.stringify({ role: "vendor", preset, breakdown: "site", periodLabel: index ? "2026 YTD" : "2025", rows: [{ siteName: "North Gate", amount: index ? "8.00" : "12.00" }] }),
    }));
    expect(askVRevenueComparison(calls)).toMatchObject({ title: "Revenue by site", rows: [{ label: "North Gate", previous: 12, current: 8 }] });
  });
});
