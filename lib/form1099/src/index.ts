// Shared 1099 form-routing rules used by both the admin invoice UI and
// the server-rendered invoice PDF. Mirrors the filters used by the
// year-end reports in artifacts/api-server/src/lib/reports/{nec,misc,k}1099.ts:
//
//   * NEC report:  incomeCategory === 'nec'  AND  method != 'credit_card'
//   * MISC report: incomeCategory IN ('misc_*')   (no method filter)
//   * K report:    method === 'credit_card'        (no category filter)
//
// Practical consequence: only NEC lines diverge based on payment
// method. MISC and K-categorised lines always route to their planned
// form regardless of how the invoice was paid.
//
// This logic was previously duplicated between the web UI
// (`artifacts/vndrly/src/lib/form1099.ts`) and would have to be ported
// again to the api-server for the PDF. Extracting it here keeps a
// single source of truth so the badges, tags, and PDF can never drift.

export const FORMS_1099 = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k",
  "none",
] as const;
export type Form1099 = (typeof FORMS_1099)[number];

export type IncomeCategory =
  | "nec"
  | "misc_rents"
  | "misc_royalties"
  | "misc_other_income"
  | "misc_prizes_awards"
  | "misc_medical_health"
  | "misc_attorney"
  | "k_third_party_network"
  | "none";

export interface PaymentLite {
  amount: string | number;
  method: string;
}

export interface FormAllocation {
  form: Form1099;
  amount: number;
}

export interface LineRouting {
  /** Form chosen by the line's income_category alone. */
  plannedForm: Form1099;
  /**
   * One entry per form the line will actually contribute to. Sums to
   * the line amount. For NEC lines partially paid by credit card, this
   * has both a `nec` and a `k` entry. For everything else there is one
   * entry equal to the full line amount.
   */
  effective: FormAllocation[];
  /** True when any non-zero `effective` entry differs from `plannedForm`. */
  isFlagged: boolean;
}

/** Map an income category to the form code its category implies. */
export function plannedFormFor(category: IncomeCategory | string): Form1099 {
  if (category === "k_third_party_network") return "k";
  // 'nec' / 'misc_*' / 'none' map 1:1 to the same Form1099 value.
  // Defensive cast for legacy values: anything unknown falls through
  // to its raw string and the `Form1099` union (callers should treat
  // unknown values as "none" if they care).
  return category as Form1099;
}

/**
 * Compute the effective form routing for a single invoice line.
 *
 * The backend `nec1099` report apportions a line by
 * `LEAST(payment.amount, invoice.total) / invoice.total` per payment
 * and excludes credit-card payments. We replicate that proportional
 * split here so the UI/PDF match what the year-end report will produce.
 *
 * Unpaid portions of NEC lines are projected to the planned NEC form —
 * that's how they will report once the invoice is paid by a non-card
 * method, which is the default.
 */
export function routeLine(args: {
  lineAmount: number | string;
  category: IncomeCategory;
  invoiceTotal: number | string;
  payments: PaymentLite[];
}): LineRouting {
  const lineAmount = num(args.lineAmount);
  const invoiceTotal = num(args.invoiceTotal);
  const planned = plannedFormFor(args.category);

  // Categories other than `nec` route entirely to their planned form
  // regardless of payment method — see file header.
  if (args.category !== "nec") {
    return {
      plannedForm: planned,
      effective: [{ form: planned, amount: round2(lineAmount) }],
      isFlagged: false,
    };
  }

  // NEC line. Credit-card-paid portion routes to 1099-K instead.
  if (invoiceTotal <= 0 || lineAmount === 0) {
    return {
      plannedForm: "nec",
      effective:
        lineAmount === 0 ? [] : [{ form: "nec", amount: round2(lineAmount) }],
      isFlagged: false,
    };
  }

  let ccPortion = 0;
  let nonCcPortion = 0;
  for (const p of args.payments) {
    const amt = num(p.amount);
    if (amt <= 0) continue;
    if (p.method === "credit_card") ccPortion += amt;
    else nonCcPortion += amt;
  }
  const totalPaid = ccPortion + nonCcPortion;
  // Match the backend's LEAST(payment, total)/total cap: payments above
  // the invoice total don't double-route.
  if (totalPaid > invoiceTotal) {
    const scale = invoiceTotal / totalPaid;
    ccPortion *= scale;
    nonCcPortion *= scale;
  }

  const ccFraction = ccPortion / invoiceTotal;
  // Non-cc-paid + still-unpaid both land on NEC.
  const necFraction = 1 - ccFraction;

  // Compute NEC first then derive K so the two always sum exactly to
  // lineAmount (avoids a 1¢ drift from independent rounding).
  const necAmt = round2(lineAmount * necFraction);
  const kAmt = round2(lineAmount - necAmt);

  const effective: FormAllocation[] = [];
  if (necAmt > 0) effective.push({ form: "nec", amount: necAmt });
  if (kAmt > 0) effective.push({ form: "k", amount: kAmt });

  return {
    plannedForm: "nec",
    effective,
    isFlagged: kAmt > 0,
  };
}

// ──────────────────────────────────────────────────────────────────
// 1099-category-vs-line-type heuristic
// ──────────────────────────────────────────────────────────────────
//
// `income_category` defaults to `nec` for every line we generate, but
// many line types are not 1099-NEC compensation at all (mileage, per
// diem, materials reimbursements, equipment rentals…). AP staff
// previously had to scan each line by hand to spot the obvious wrong
// defaults; this heuristic flags the implausible combinations so the
// admin UI can warn at edit time and a reports-page health check can
// audit historical mismatches.
//
// The matrix below intentionally only encodes the line types where the
// expected categor(ies) are well-defined. `markup` and `other` are
// deliberately omitted: their correct categorisation depends entirely
// on what the underlying line represents, so flagging them would be
// noise. `INVOICE_LINE_TYPES`, the full source list, lives in
// `lib/db/src/schema/invoiceLines.ts`. Keep this in sync when a new
// line type is added.

export type InvoiceLineTypeForAudit =
  | "labor_regular"
  | "labor_overtime"
  | "equipment"
  | "materials"
  | "mileage"
  | "per_diem"
  | "markup"
  | "discount"
  | "other";

const ALLOWED_CATEGORIES_BY_LINE_TYPE: Partial<
  Record<InvoiceLineTypeForAudit, IncomeCategory[]>
> = {
  // Labor is service compensation. NEC is the typical case; attorneys
  // and medical providers route to MISC boxes 10/6 instead. Allowing
  // `none` covers internal/transferred labor that shouldn't be reported.
  labor_regular: ["nec", "misc_attorney", "misc_medical_health", "none"],
  labor_overtime: ["nec", "misc_attorney", "misc_medical_health", "none"],
  // Equipment is either a rental (1099-MISC Box 1 Rents) or a passed-
  // through cost reimbursement (not reportable). Tagging it NEC has
  // historically been the most common bug.
  equipment: ["misc_rents", "none"],
  // Materials are passed-through purchases. Some partners record them
  // as Box 3 "Other income" but the typical answer is "not reportable".
  materials: ["none", "misc_other_income"],
  // Mileage and per-diem reimburse the field employee for expenses the
  // worker already paid out-of-pocket — they're explicitly NOT 1099
  // compensation, so anything other than `none` is a mistake.
  mileage: ["none"],
  per_diem: ["none"],
  // A negative discount line should never carry a positive 1099 amount.
  discount: ["none"],
};

export interface SuspectMatch {
  /** True when the (lineType, category) combo is flagged. */
  suspect: boolean;
  /** Categories the AP heuristic considers reasonable for this line. */
  suggested: IncomeCategory[];
}

/**
 * Returns whether the given (lineType, category) pair is implausible
 * per the AP heuristic. Unknown line types and the deliberately
 * permissive `markup` / `other` types always return `suspect: false`.
 */
export function suspectMatch(
  lineType: string | null | undefined,
  category: IncomeCategory | string | null | undefined,
): SuspectMatch {
  if (!lineType || !category) return { suspect: false, suggested: [] };
  const allowed =
    ALLOWED_CATEGORIES_BY_LINE_TYPE[lineType as InvoiceLineTypeForAudit];
  if (!allowed) return { suspect: false, suggested: [] };
  if (allowed.includes(category as IncomeCategory)) {
    return { suspect: false, suggested: allowed };
  }
  return { suspect: true, suggested: allowed };
}

/** Sum a list of allocations into per-form totals. */
export function sumByForm(
  allocations: FormAllocation[],
): Record<Form1099, number> {
  const out: Record<Form1099, number> = {
    nec: 0,
    misc_rents: 0,
    misc_royalties: 0,
    misc_other_income: 0,
    misc_prizes_awards: 0,
    misc_medical_health: 0,
    misc_attorney: 0,
    k: 0,
    none: 0,
  };
  for (const a of allocations) out[a.form] = round2(out[a.form] + a.amount);
  return out;
}

// ── Form labels ──────────────────────────────────────────────────
//
// Short, IRS-style labels rendered on the PDF and accountant-facing
// exports. Box numbers are included so a recipient can map a line
// straight to the box of the IRS form. Mirrors the
// `invoices.form1099.*` strings in artifacts/vndrly/src/lib/locales/
// (which use a slightly chattier, screen-friendly form).

export const FORM_1099_LOCALES = ["en", "es"] as const;
export type Form1099Locale = (typeof FORM_1099_LOCALES)[number];

export const FORM_1099_LABELS_BY_LOCALE: Record<
  Form1099Locale,
  Record<Form1099, string>
> = {
  en: {
    nec: "1099-NEC",
    misc_rents: "1099-MISC Box 1",
    misc_royalties: "1099-MISC Box 2",
    misc_other_income: "1099-MISC Box 3",
    misc_prizes_awards: "1099-MISC Box 3",
    misc_medical_health: "1099-MISC Box 6",
    misc_attorney: "1099-MISC Box 10",
    k: "1099-K",
    none: "Not reportable",
  },
  es: {
    nec: "1099-NEC",
    misc_rents: "1099-MISC casilla 1",
    misc_royalties: "1099-MISC casilla 2",
    misc_other_income: "1099-MISC casilla 3",
    misc_prizes_awards: "1099-MISC casilla 3",
    misc_medical_health: "1099-MISC casilla 6",
    misc_attorney: "1099-MISC casilla 10",
    k: "1099-K",
    none: "No declarable",
  },
};

/** Localized short label for a 1099 form code. Falls back to English on
 *  unknown locales and to the raw code on unknown forms. */
export function form1099Label(
  form: Form1099 | string,
  locale: Form1099Locale = "en",
): string {
  const table =
    FORM_1099_LABELS_BY_LOCALE[locale] ?? FORM_1099_LABELS_BY_LOCALE.en;
  return table[form as Form1099] ?? String(form);
}

function num(v: number | string): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
