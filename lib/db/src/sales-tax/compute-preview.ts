import { resolveEffectiveTaxTreatment } from "./rubrics";
import { resolveLineTaxability } from "./taxability";
import type { TaxTreatment, TicketLineTaxInput, TicketTaxPreview } from "./types";

export function computeTicketTaxPreview(args: {
  lineItems: ReadonlyArray<TicketLineTaxInput>;
  combinedTaxRate: number;
  state: string | null | undefined;
  jurisdictionLabel?: string | null;
  taxTreatment?: TaxTreatment | null;
  partnerTreatment?: TaxTreatment | null;
  vendorTreatment?: TaxTreatment | null;
  workTypeTreatment?: TaxTreatment | null;
  workTypeCategory?: string | null;
  /** When set (e.g. from GET /tickets/:id), skips re-resolving the override chain. */
  effectiveTaxTreatment?: TaxTreatment | null;
}): TicketTaxPreview {
  let laborSubtotal = 0;
  let merchandiseSubtotal = 0;
  let exemptSubtotal = 0;
  let taxableSubtotal = 0;
  let laborTax = 0;
  let merchandiseTax = 0;
  let subtotal = 0;
  const rate = Number.isFinite(args.combinedTaxRate) ? args.combinedTaxRate : 0;
  const resolvedTreatment =
    args.effectiveTaxTreatment ??
    resolveEffectiveTaxTreatment({
      partnerTreatment: args.partnerTreatment,
      vendorTreatment: args.vendorTreatment,
      workTypeTreatment: args.workTypeTreatment ?? args.taxTreatment,
      workTypeCategory: args.workTypeCategory,
      state: args.state,
    });

  for (const item of args.lineItems) {
    const amount = parseFloat(item.quantity) * parseFloat(item.unitPrice);
    if (!Number.isFinite(amount)) continue;
    subtotal += amount;

    const taxable = resolveLineTaxability({
      lineType: item.type,
      state: args.state,
      taxTreatment: resolvedTreatment,
      taxableOverride: item.taxableOverride,
    });

    const t = item.type.toLowerCase();
    const isLabor = t === "labor";
    const isMerch =
      t === "part" ||
      t === "parts" ||
      t === "equipment" ||
      t === "materials" ||
      t === "markup" ||
      t === "other";

    if (isLabor) laborSubtotal += amount;
    else if (isMerch) merchandiseSubtotal += amount;
    else exemptSubtotal += amount;

    if (!taxable) continue;

    taxableSubtotal += amount;
    if (isLabor) laborTax += amount * rate;
    else merchandiseTax += amount * rate;
  }

  const taxAmount = laborTax + merchandiseTax;

  return {
    subtotal,
    taxableSubtotal,
    exemptSubtotal,
    laborSubtotal,
    merchandiseSubtotal,
    laborTax,
    merchandiseTax,
    taxAmount,
    grandTotal: subtotal + taxAmount,
    combinedTaxRate: rate,
    jurisdictionLabel: args.jurisdictionLabel ?? null,
  };
}
