import { describe, expect, it } from "vitest";
import { computeTicketTaxPreview } from "@workspace/db";it("taxes reviewed payable Fleet amounts, including signed adjustments, rather than rounded display quantities",()=>{ const charge=(id:string,amount:string,exact:string)=>({version:2,charge:{id,revision:1,quantity:"123.456789",unitRate:"0.0125",currencyAmount:amount,exactAmount:exact,currency:"USD",reviewedByUserId:7,reviewedAt:"2026-10-17T18:00:00Z"}}); const result=computeTicketTaxPreview({state:"TX",combinedTaxRate:0.0625,lineItems:[{type:"other",quantity:"123.46",unitPrice:"0.01",preciseQuantity:"123.456789",preciseUnitPrice:"0.0125",fleetBillingMetadata:charge("11111111-1111-4111-8111-111111111111","1.54","1.5432098625"),taxableOverride:true},{type:"other",quantity:"1",unitPrice:"0",preciseQuantity:"123.456789",preciseUnitPrice:"0.0125",fleetBillingMetadata:charge("22222222-2222-4222-8222-222222222222","-0.04","-0.04"),taxableOverride:true}]}); expect(result.preciseTotals).toEqual({subtotal:"1.5",taxAmount:"0.1",grandTotal:"1.6"});});

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
