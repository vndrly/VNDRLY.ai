import { describe, expect, it } from "vitest";
import {
  computeTicketTaxPreview,
  getStateRubric,
  resolveLineTaxability,
  resolveEffectiveTaxTreatment,
} from "@workspace/db";

describe("sales-tax rubrics", () => {
  it("TX exempts field labor but taxes parts at combined rate", () => {
    expect(
      resolveLineTaxability({
        lineType: "labor_regular",
        state: "TX",
        taxTreatment: "exempt_labor",
      }),
    ).toBe(false);
    expect(
      resolveLineTaxability({
        lineType: "materials",
        state: "TX",
        taxTreatment: "exempt_labor",
      }),
    ).toBe(true);
  });

  it("TX taxes repair-service labor", () => {
    expect(
      resolveLineTaxability({
        lineType: "labor_regular",
        state: "TX",
        taxTreatment: "taxable_repair_service",
      }),
    ).toBe(true);
  });

  it("NM taxes labor by default (GRT)", () => {
    const rubric = getStateRubric("NM");
    expect(rubric?.defaultLaborTaxable).toBe(true);
    expect(
      resolveLineTaxability({
        lineType: "labor_regular",
        state: "NM",
        taxTreatment: "taxable_all",
      }),
    ).toBe(true);
  });

  it("NJ exempts field labor but taxes parts at 6.625% situs rate", () => {
    const rubric = getStateRubric("NJ");
    expect(rubric?.defaultStateRate).toBe("0.06625");
    expect(rubric?.defaultLaborTaxable).toBe(false);
    expect(
      resolveLineTaxability({
        lineType: "labor_regular",
        state: "NJ",
        taxTreatment: "exempt_labor",
      }),
    ).toBe(false);
    expect(
      resolveLineTaxability({
        lineType: "materials",
        state: "NJ",
        taxTreatment: "exempt_labor",
      }),
    ).toBe(true);
  });

  it("computeTicketTaxPreview uses single combined situs rate", () => {
    const preview = computeTicketTaxPreview({
      lineItems: [
        { type: "labor", quantity: "10", unitPrice: "100" },
        { type: "part", quantity: "2", unitPrice: "50" },
      ],
      combinedTaxRate: 0.0625,
      state: "TX",
      workTypeCategory: "operations",
    });
    expect(preview.laborTax).toBe(0);
    expect(preview.merchandiseTax).toBeCloseTo(6.25);
    expect(preview.taxAmount).toBeCloseTo(6.25);
  });

  it("computeTicketTaxPreview honors effectiveTaxTreatment override", () => {
    const preview = computeTicketTaxPreview({
      lineItems: [{ type: "labor", quantity: "10", unitPrice: "100" }],
      combinedTaxRate: 0.0625,
      state: "TX",
      workTypeCategory: "operations",
      effectiveTaxTreatment: "taxable_repair_service",
    });
    expect(preview.laborTax).toBeCloseTo(62.5);
  });

  it("partner tax treatment override wins", () => {
    const treatment = resolveEffectiveTaxTreatment({
      partnerTreatment: "taxable_repair_service",
      vendorTreatment: "exempt_labor",
      workTypeTreatment: "exempt_labor",
      workTypeCategory: "operations",
      state: "TX",
    });
    expect(treatment).toBe("taxable_repair_service");
  });
});
