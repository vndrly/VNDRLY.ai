import { describe, expect, it } from "vitest";
import { renderCategoryAuditPdf } from "./categoryAuditPdf";
import type { CategoryAuditResult } from "./categoryAudit";

const baseRow: CategoryAuditResult["rows"][number] = {
  invoiceId: 1,
  invoiceNumber: "INV-1",
  invoiceStatus: "paid",
  invoiceTotal: "100.00",
  invoiceCreatedAt: new Date().toISOString(),
  vendorId: 1,
  vendorName: "Acme Crew",
  partnerId: 2,
  partnerName: "Big Co",
  lineId: 10,
  lineType: "labor_regular",
  description: "Site labor",
  amount: "100.00",
  incomeCategory: "misc_rents",
  suggestedCategories: ["nec"],
};

describe("renderCategoryAuditPdf", () => {
  it("renders a non-empty PDF buffer when there are suspect rows", async () => {
    const audit: CategoryAuditResult = {
      rows: [baseRow],
      summary: {
        byCategory: { misc_rents: 1 },
        byLineType: { labor_regular: 1 },
        totalAmount: "100.00",
      },
    };
    const buf = await renderCategoryAuditPdf(audit, {
      scopeLabel: "Vendor 1",
    });
    expect(buf.byteLength).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("renders a PDF buffer when there are no suspect rows", async () => {
    const audit: CategoryAuditResult = {
      rows: [],
      summary: { byCategory: {}, byLineType: {}, totalAmount: "0.00" },
    };
    const buf = await renderCategoryAuditPdf(audit, {
      scopeLabel: "Partner 7",
    });
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("paginates many rows across multiple pages", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...baseRow,
      invoiceId: i,
      invoiceNumber: `INV-${i}`,
      lineId: i,
    }));
    const audit: CategoryAuditResult = {
      rows,
      summary: {
        byCategory: { misc_rents: rows.length },
        byLineType: { labor_regular: rows.length },
        totalAmount: (rows.length * 100).toFixed(2),
      },
    };
    const buf = await renderCategoryAuditPdf(audit, {
      scopeLabel: "Vendor 1",
    });
    // pdfkit emits one /Type /Page per page; a 200-row table must
    // span more than one page.
    const pageCount = (buf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? [])
      .length;
    expect(pageCount).toBeGreaterThan(1);
  });
});
