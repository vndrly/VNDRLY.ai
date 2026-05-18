// Re-export of the shared 1099 form-routing rules. The implementation
// now lives in @workspace/form1099 so the admin UI and the server-
// rendered invoice PDF share a single source of truth (see task #309).
//
// Kept as a thin re-export so existing `@/lib/form1099` imports across
// the web client keep working without a sweeping rename.
export {
  FORMS_1099,
  type Form1099,
  type FormAllocation,
  type IncomeCategory,
  type LineRouting,
  type PaymentLite,
  plannedFormFor,
  routeLine,
  sumByForm,
  form1099Label,
  type Form1099Locale,
  // 1099-category-vs-line-type heuristic (task #310): also lives in
  // the shared package so the in-the-moment invoice warnings here and
  // the year-end audit in api-server's categoryAudit.ts can never drift.
  suspectMatch,
  type SuspectMatch,
  type InvoiceLineTypeForAudit,
} from "@workspace/form1099";
