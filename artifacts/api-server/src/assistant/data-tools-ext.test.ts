import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/reports/sales-tax", () => ({
  salesTaxByState: vi.fn(async () => ({ rows: [], totals: {} })),
}));

vi.mock("../lib/reports/nec1099", () => ({
  nec1099Rows: vi.fn(async () => []),
  NEC_THRESHOLD_USD: 600,
}));

vi.mock("../lib/reports/k1099", () => ({
  k1099Rows: vi.fn(async () => []),
  thresholdForYear: () => 600,
}));

vi.mock("../lib/reports/misc1099", () => ({
  misc1099Rows: vi.fn(async () => []),
}));

vi.mock("../lib/reports/line-detail", () => ({
  lineDetailRows: vi.fn(async () => []),
}));

vi.mock("../lib/reports/aging", () => ({
  agingForVendor: vi.fn(async () => ({ rows: [], totals: { total: "0" } })),
  agingForPartner: vi.fn(async () => ({ rows: [], totals: { total: "0" } })),
}));

vi.mock("../lib/reports/revenue", () => ({
  revenueByPartner: vi.fn(async () => []),
  revenueByWorkType: vi.fn(async () => []),
  spendByVendor: vi.fn(async () => []),
}));

vi.mock("../lib/reports/crew-cost", () => ({
  crewHoursBilledVsCost: vi.fn(async () => ({
    rows: [],
    totals: { employeeName: "TOTAL", hours: "0", cost: "0", billed: "0", margin: "0" },
  })),
}));

import { runDataTool } from "./data-tools";
import { EXT_DATA_TOOL_NAMES } from "./data-tools-ext";

describe("EXT_DATA_TOOL_NAMES", () => {
  it("registers twelve extended tools", () => {
    expect(EXT_DATA_TOOL_NAMES).toHaveLength(12);
    expect(EXT_DATA_TOOL_NAMES).toContain("query_ticket_detail");
    expect(EXT_DATA_TOOL_NAMES).toContain("query_1099_misc_summary");
  });
});

describe("runDataTool — extended toolbox gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("query_ticket_detail requires ticketId", async () => {
    const out = JSON.parse(
      await runDataTool("query_ticket_detail", {}, { role: "vendor", vendorId: 1, userId: 1 } as never),
    );
    expect(out.error).toMatch(/ticketId/i);
  });

  it("query_work_type_history requires work type filter", async () => {
    const out = JSON.parse(
      await runDataTool("query_work_type_history", {}, { role: "vendor", vendorId: 1, userId: 1 } as never),
    );
    expect(out.error).toMatch(/workType/i);
  });

  it("query_invoice_lines blocks field employees", async () => {
    const out = JSON.parse(
      await runDataTool(
        "query_invoice_lines",
        { preset: "ytd" },
        { role: "field_employee", userId: 1, vendorPeopleId: 1 } as never,
      ),
    );
    expect(out.error).toMatch(/not available to field employees/i);
  });

  it("query_crew_cost is vendor-only", async () => {
    const partnerOut = JSON.parse(
      await runDataTool(
        "query_crew_cost",
        { preset: "ytd" },
        { role: "partner", partnerId: 1, userId: 1 } as never,
      ),
    );
    expect(partnerOut.error).toMatch(/vendor accounts/i);
  });

  it("query_1099_k_summary blocks field employees", async () => {
    const out = JSON.parse(
      await runDataTool(
        "query_1099_k_summary",
        { year: 2026 },
        { role: "field_employee", userId: 1 } as never,
      ),
    );
    expect(out.error).toMatch(/not available to field employees/i);
  });
});
