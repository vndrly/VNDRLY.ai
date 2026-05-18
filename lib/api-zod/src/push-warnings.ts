// Shared formatter for QuickBooks / OpenAccountant push warnings.
//
// Lives in @workspace/api-zod so the api-server (which sends digest emails)
// and the vndrly Reports page (which renders the in-app "Copy all" button)
// emit identical wording. This used to be its own @workspace/push-warnings
// package — see task #354 for why it was folded back in.

export interface PushWarning {
  kind: "customer" | "vendor" | "invoice";
  identifier: string;
  message: string;
}

/** Format a single warning as the human-readable line admins paste into
 *  QuickBooks support / a slack thread, e.g.
 *  "Invoice INV-123: tax of 42.50 not posted (sales tax is disabled in
 *  QuickBooks). Configure sales tax in QuickBooks and re-push." */
export function formatPushWarningLine(w: PushWarning): string {
  const kindLabel = w.kind.charAt(0).toUpperCase() + w.kind.slice(1);
  return `${kindLabel} ${w.identifier}: ${w.message}`;
}

/** Format the full warning block as multi-line text for copy/share. */
export function formatPushWarningsForCopy(warnings: PushWarning[]): string {
  return warnings.map(formatPushWarningLine).join("\n");
}

/** True when the warning was emitted by the post-push reconciler rather
 *  than by a per-row push failure. Reconciliation warnings come in three
 *  shapes:
 *    - identifier === "(reconciliation)"           — the reconciler couldn't
 *                                                    read invoices back at all.
 *    - identifier starts with "(state:"            — per-state aggregate
 *                                                    tax mismatch.
 *    - identifier is an invoice number, but message starts with
 *      "reconciliation:"                           — per-invoice
 *                                                    total/tax mismatch.
 *
 *  Used by the api-server to route post-push warnings to either the
 *  failure digest (per-row failures) or the reconciliation-only digest
 *  (everything succeeded but the totals drifted), and by the Reports
 *  page to bucket the same warnings visually. Keeping the predicate in
 *  one shared module guarantees the server's email routing and the
 *  client's UI grouping always agree on what counts as reconciliation. */
export function isReconciliationWarning(w: PushWarning): boolean {
  return (
    w.identifier === "(reconciliation)" ||
    w.identifier.startsWith("(state:") ||
    w.message.startsWith("reconciliation:") ||
    w.message.startsWith("reconciliation skipped")
  );
}
