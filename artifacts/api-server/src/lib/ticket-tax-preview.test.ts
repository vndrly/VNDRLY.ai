import { describe, expect, it } from "vitest";
import { computeTicketTaxPreview } from "@workspace/db";

describe("computeTicketTaxPreview", () => {
  it("applies combined situs rate to taxable lines only in TX", () => {
    const preview = computeTicketTaxPreview({
      lineItems: [
        { type: "labor", quantity: "10", unitPrice: "100" },
        { type: "part", quantity: "2", unitPrice: "50" },
        { type: "mileage", quantity: "40", unitPrice: "0.67" },
      ],
      combinedTaxRate: 0.0625,
      state: "TX",
      workTypeCategory: "operations",
    });
    expect(preview.laborSubtotal).toBe(1000);
    expect(preview.merchandiseSubtotal).toBe(100);
    expect(preview.laborTax).toBe(0);
    expect(preview.merchandiseTax).toBeCloseTo(6.25);
    expect(preview.taxAmount).toBeCloseTo(6.25);
    expect(preview.grandTotal).toBeCloseTo(1133.05);
  });
});
