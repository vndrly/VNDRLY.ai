import type { StateTaxRubric, SupportedTaxState, TaxTreatment } from "./types";

export const STATE_TAX_RUBRICS: Record<SupportedTaxState, StateTaxRubric> = {
  TX: {
    state: "TX",
    stateName: "Texas",
    taxKind: "sales_tax",
    defaultStateRate: "0.0625",
    defaultLaborTaxable: false,
    defaultTppTaxable: true,
    repairServiceTaxesLabor: true,
    rateRange: { min: "0.0625", max: "0.0825" },
    summary:
      "Texas taxes tangible personal property at the situs rate (6.25% state + up to 2% local). " +
      "Most field labor is exempt unless the work is a listed taxable service (e.g. equipment repair).",
  },
  OK: {
    state: "OK",
    stateName: "Oklahoma",
    taxKind: "sales_tax",
    defaultStateRate: "0.0450",
    defaultLaborTaxable: false,
    defaultTppTaxable: true,
    repairServiceTaxesLabor: true,
    rateRange: { min: "0.0450", max: "0.1100" },
    summary:
      "Oklahoma taxes tangible goods and many enumerated services at state + local rates. " +
      "General field crew labor is treated as exempt unless classified as repair/maintenance service.",
  },
  NM: {
    state: "NM",
    stateName: "New Mexico",
    taxKind: "gross_receipts",
    defaultStateRate: "0.05125",
    defaultLaborTaxable: true,
    defaultTppTaxable: true,
    repairServiceTaxesLabor: true,
    rateRange: { min: "0.05125", max: "0.09000" },
    summary:
      "New Mexico gross receipts tax applies broadly to services and goods at the location " +
      "where work is performed. Crew labor is taxable at the site combined GRT rate unless overridden.",
  },
  NJ: {
    state: "NJ",
    stateName: "New Jersey",
    taxKind: "sales_tax",
    defaultStateRate: "0.06625",
    defaultLaborTaxable: false,
    defaultTppTaxable: true,
    repairServiceTaxesLabor: true,
    rateRange: { min: "0.06625", max: "0.06625" },
    summary:
      "New Jersey sales tax is 6.625% statewide for tangible personal property at the situs. " +
      "Most field crew labor on well sites is a non-enumerated service and exempt; repair/maintenance " +
      "of equipment and TPP are taxable at the combined rate (Urban Enterprise Zone reductions apply locally).",
  },
};

const SUPPORTED = new Set<string>(["TX", "OK", "NM", "NJ"]);

export function normalizeTaxState(
  state: string | null | undefined,
): SupportedTaxState | null {
  if (!state?.trim()) return null;
  const code = state.trim().toUpperCase();
  return SUPPORTED.has(code) ? (code as SupportedTaxState) : null;
}

export function getStateRubric(
  state: string | null | undefined,
): StateTaxRubric | null {
  const code = normalizeTaxState(state);
  return code ? STATE_TAX_RUBRICS[code] : null;
}

/** Infer treatment from catalog category when no explicit taxTreatment is set. */
export function inferTaxTreatmentFromCategory(
  category: string | null | undefined,
  state: string | null | undefined,
): TaxTreatment {
  const rubric = getStateRubric(state);
  if (rubric?.defaultLaborTaxable && rubric.defaultTppTaxable) {
    return "taxable_all";
  }

  const c = (category ?? "").toLowerCase();
  if (
    /repair|maintenance|service|welding|pump|equipment|install|remediation|clean/i.test(
      c,
    )
  ) {
    return "taxable_repair_service";
  }
  return "exempt_labor";
}

export function resolveEffectiveTaxTreatment(args: {
  partnerTreatment: TaxTreatment | null | undefined;
  vendorTreatment: TaxTreatment | null | undefined;
  workTypeTreatment: TaxTreatment | null | undefined;
  workTypeCategory: string | null | undefined;
  state: string | null | undefined;
}): TaxTreatment {
  if (args.partnerTreatment && isTaxTreatment(args.partnerTreatment)) {
    return args.partnerTreatment;
  }
  if (args.vendorTreatment && isTaxTreatment(args.vendorTreatment)) {
    return args.vendorTreatment;
  }
  if (args.workTypeTreatment && isTaxTreatment(args.workTypeTreatment)) {
    return args.workTypeTreatment;
  }
  return inferTaxTreatmentFromCategory(args.workTypeCategory, args.state);
}

export function isTaxTreatment(value: string): value is TaxTreatment {
  return value === "exempt_labor" || value === "taxable_repair_service" || value === "taxable_all";
}
