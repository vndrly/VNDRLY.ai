import {resolveEffectiveFinancialLine,parseExactDecimal,addExact,multiplyExact,roundExact,formatExact} from "../format";
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

  if(args.lineItems.some(item=>item.fleetBillingMetadata)){
    const totals={subtotal:parseExactDecimal("0"),taxableSubtotal:parseExactDecimal("0"),exemptSubtotal:parseExactDecimal("0"),laborSubtotal:parseExactDecimal("0"),merchandiseSubtotal:parseExactDecimal("0"),laborTax:parseExactDecimal("0"),merchandiseTax:parseExactDecimal("0")};
    for(const item of args.lineItems){
      const exact=resolveEffectiveFinancialLine(item),amount=parseExactDecimal(exact.currencyAmount),labor=item.type.toLowerCase()==="labor",merch=["part","parts","equipment","materials","markup","other"].includes(item.type.toLowerCase());
      const taxable=resolveLineTaxability({lineType:item.type,state:args.state,taxTreatment:resolvedTreatment,taxableOverride:item.taxableOverride});
      totals.subtotal=addExact(totals.subtotal,amount);
      const bucket=labor?"laborSubtotal":merch?"merchandiseSubtotal":"exemptSubtotal";totals[bucket]=addExact(totals[bucket],amount);
      if(taxable){totals.taxableSubtotal=addExact(totals.taxableSubtotal,amount);const tax=roundExact(multiplyExact(amount,parseExactDecimal(String(rate))),{scale:2,rounding:"half_away_from_zero"}),taxBucket=labor?"laborTax":"merchandiseTax";totals[taxBucket]=addExact(totals[taxBucket],tax);}
    }
    const tax=addExact(totals.laborTax,totals.merchandiseTax),grand=addExact(totals.subtotal,tax);
    return {subtotal:Number(formatExact(totals.subtotal)),taxableSubtotal:Number(formatExact(totals.taxableSubtotal)),exemptSubtotal:Number(formatExact(totals.exemptSubtotal)),laborSubtotal:Number(formatExact(totals.laborSubtotal)),merchandiseSubtotal:Number(formatExact(totals.merchandiseSubtotal)),laborTax:Number(formatExact(totals.laborTax)),merchandiseTax:Number(formatExact(totals.merchandiseTax)),taxAmount:Number(formatExact(tax)),grandTotal:Number(formatExact(grand)),combinedTaxRate:rate,jurisdictionLabel:args.jurisdictionLabel??null,preciseTotals:{subtotal:formatExact(totals.subtotal),taxAmount:formatExact(tax),grandTotal:formatExact(grand)}};
  }
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
