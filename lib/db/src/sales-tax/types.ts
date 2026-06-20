/** How a work type (or override) treats labor vs goods for sales/GRT tax. */
export const TAX_TREATMENTS = [
  /** Field crew / consulting — labor not taxed (TX, OK default). */
  "exempt_labor",
  /** Repair/maintenance — labor and TPP taxed at site combined rate (TX, OK). */
  "taxable_repair_service",
  /** Gross receipts / broad service tax — labor and goods taxed (NM default). */
  "taxable_all",
] as const;

export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export type SupportedTaxState = "TX" | "OK" | "NM" | "NJ";

export type StateTaxKind = "sales_tax" | "gross_receipts";

export type StateTaxRubric = {
  state: SupportedTaxState;
  stateName: string;
  taxKind: StateTaxKind;
  /** Typical state-only rate (decimal fraction). Overridden by tax_rates row when present. */
  defaultStateRate: string;
  /** Whether crew labor is taxable when no work-type override applies. */
  defaultLaborTaxable: boolean;
  /** Parts, equipment, materials are always TPP unless line override says otherwise. */
  defaultTppTaxable: boolean;
  /** When taxTreatment is taxable_repair_service, labor hours are taxed. */
  repairServiceTaxesLabor: boolean;
  rateRange: { min: string; max: string };
  summary: string;
};

export type SiteTaxSnapshot = {
  state: string;
  postalCode: string | null;
  county: string | null;
  city: string | null;
  jurisdictionLabel: string;
  stateTaxRate: string;
  localTaxRate: string;
  combinedTaxRate: string;
  provider: "rubric_fallback" | "county_seat" | "fallback";
};

export type TicketLineTaxInput = {
  type: string;
  quantity: string;
  unitPrice: string;
  taxableOverride?: boolean | null;
};

export type TicketTaxPreview = {
  subtotal: number;
  taxableSubtotal: number;
  exemptSubtotal: number;
  laborSubtotal: number;
  merchandiseSubtotal: number;
  laborTax: number;
  merchandiseTax: number;
  taxAmount: number;
  grandTotal: number;
  combinedTaxRate: number;
  jurisdictionLabel: string | null;
};
