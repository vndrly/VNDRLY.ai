import { describe, expect, it } from "vitest";
import { lineDetailToCsv, type LineDetailRow } from "./line-detail";

describe("lineDetailToCsv", () => {
  it("emits RFC-4180 headers and one row per line", () => {
    const rows: LineDetailRow[] = [
      {
        invoiceId: 1,
        invoiceNumber: "INV-001",
        invoiceStatus: "open",
        invoiceDate: "2026-01-15T00:00:00.000Z",
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-31T00:00:00.000Z",
        ticketId: 42,
        partnerId: 2,
        partnerName: "Acme Partner",
        vendorId: 3,
        vendorName: "Baker Co",
        workTypeName: "Hot Oil",
        siteName: "Well 12",
        employeeName: "Joe Boggs",
        lineType: "labor_regular",
        description: "Regular labor",
        quantity: "8.0000",
        unit: "hr",
        unitPrice: "75.0000",
        amount: "600.00",
        taxable: true,
        taxState: "TX",
        taxRate: "0.0825",
        taxAmount: "49.50",
        afe: "AFE-100",
        incomeCategory: "nec",
      },
    ];
    const csv = lineDetailToCsv(rows);
    expect(csv).toContain("InvoiceNumber,InvoiceDate");
    expect(csv).toContain("INV-001,2026-01-15");
    expect(csv).toContain("Joe Boggs");
    expect(csv).toContain("AFE-100");
  });
});
