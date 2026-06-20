import { getStateRubric, resolveEffectiveTaxTreatment } from "./rubrics";
import type { TaxTreatment } from "./types";

export function isMerchandiseLineType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t === "part" ||
    t === "parts" ||
    t === "equipment" ||
    t === "materials" ||
    t === "markup" ||
    t === "other"
  );
}

export function isLaborLineType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "labor" || t === "labor_regular" || t === "labor_overtime";
}

export function isExemptLineType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "mileage" || t === "per_diem" || t === "perdiem" || t === "discount";
}

export function resolveLineTaxability(args: {
  lineType: string;
  state: string | null | undefined;
  taxTreatment: TaxTreatment;
  taxableOverride?: boolean | null;
}): boolean {
  if (args.taxableOverride != null) return args.taxableOverride;
  if (isExemptLineType(args.lineType)) return false;

  const rubric = getStateRubric(args.state);
  if (!rubric) {
    return isMerchandiseLineType(args.lineType);
  }

  if (args.taxTreatment === "taxable_all") {
    return !isExemptLineType(args.lineType);
  }

  if (isMerchandiseLineType(args.lineType)) {
    return rubric.defaultTppTaxable;
  }

  if (isLaborLineType(args.lineType)) {
    if (args.taxTreatment === "taxable_repair_service") {
      return rubric.repairServiceTaxesLabor;
    }
    return rubric.defaultLaborTaxable;
  }

  return false;
}

export function resolveTicketLineTaxability(args: {
  type: string;
  state: string | null | undefined;
  partnerTreatment?: TaxTreatment | null;
  vendorTreatment?: TaxTreatment | null;
  workTypeTreatment?: TaxTreatment | null;
  workTypeCategory?: string | null;
  taxableOverride?: boolean | null;
}): boolean {
  const taxTreatment = resolveEffectiveTaxTreatment({
    partnerTreatment: args.partnerTreatment,
    vendorTreatment: args.vendorTreatment,
    workTypeTreatment: args.workTypeTreatment,
    workTypeCategory: args.workTypeCategory,
    state: args.state,
  });
  return resolveLineTaxability({
    lineType: args.type,
    state: args.state,
    taxTreatment,
    taxableOverride: args.taxableOverride,
  });
}
