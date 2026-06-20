import { describe, expect, it } from "vitest";

import { resolveTicketTaxTreatmentFromRows } from "./ticket-tax-treatment";

describe("resolveTicketTaxTreatmentFromRows", () => {
  it("uses explicit work type treatment over category inference", () => {
    const ctx = resolveTicketTaxTreatmentFromRows({
      workTypeTaxTreatment: "exempt_labor",
      vendorWorkTypeTaxTreatment: null,
      partnerWorkTypeTaxTreatment: null,
      workTypeCategory: "Pump Repair",
      siteState: "TX",
    });
    expect(ctx.effectiveTaxTreatment).toBe("exempt_labor");
  });

  it("partner override wins over work type", () => {
    const ctx = resolveTicketTaxTreatmentFromRows({
      workTypeTaxTreatment: "exempt_labor",
      vendorWorkTypeTaxTreatment: "taxable_repair_service",
      partnerWorkTypeTaxTreatment: "taxable_all",
      workTypeCategory: "Operations",
      siteState: "TX",
    });
    expect(ctx.effectiveTaxTreatment).toBe("taxable_all");
  });

  it("infers repair treatment from category when unset", () => {
    const ctx = resolveTicketTaxTreatmentFromRows({
      workTypeTaxTreatment: null,
      vendorWorkTypeTaxTreatment: null,
      partnerWorkTypeTaxTreatment: null,
      workTypeCategory: "Equipment Maintenance",
      siteState: "TX",
    });
    expect(ctx.effectiveTaxTreatment).toBe("taxable_repair_service");
  });
});
