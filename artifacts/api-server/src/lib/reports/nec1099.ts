// 1099-NEC aggregation. Aggregates non-voided, non-credit-card payments
// against invoice lines whose `income_category` is `nec`, by
// (payerPartnerId, payeeVendorId) for a given calendar year. The IRS
// threshold is $600 per payer/payee in a calendar year.
//
// Why filter on income_category and exclude credit-card payments:
//   * Lines categorized as `misc_*` belong on the 1099-MISC.
//   * Payments made by credit card belong on the 1099-K (the TPSO
//     reports them, not the payer).
// Without these filters the same dollars could appear on multiple forms
// for the same recipient — i.e. over-reporting income to the IRS.
//
// Like the 1099-MISC rollup, each NEC line's contribution to a payment
// is apportioned by `LEAST(payment.amount, invoice.total) / invoice.total`
// so multi-line invoices and partial payments don't double-count.
//
// Vendors sharing the same EIN are NOT auto-merged — we surface a
// `sharedEinWarning` flag so the user can decide whether the rows represent
// the same legal entity (and should be combined externally) or are a data
// error to clean up.

import { and, between, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  vendorsTable,
  partnersTable,
} from "@workspace/db";

export const NEC_THRESHOLD_USD = 600;

export interface Nec1099Row {
  vendorId: number;
  vendorName: string;
  /** Federal EIN/SSN (9 digits, may be null if vendor hasn't entered it). */
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  /** Total non-voided payments in the calendar year. */
  totalPaid: string;
  /** True when at least one OTHER row in the result set has the same EIN. */
  sharedEinWarning: boolean;
}

interface RawAgg {
  vendorId: number;
  vendorName: string;
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  totalPaid: string;
}

export async function nec1099Rows(args: {
  year: number;
  /** Limit to one vendor (vendor self-serve) or undefined for all. */
  vendorId?: number;
  /** Limit to one payer (partner self-serve) or undefined for all. */
  payerPartnerId?: number;
  /** Override threshold for testing. */
  threshold?: number;
}): Promise<Nec1099Row[]> {
  const start = new Date(Date.UTC(args.year, 0, 1));
  const end = new Date(Date.UTC(args.year + 1, 0, 1));
  const threshold = args.threshold ?? NEC_THRESHOLD_USD;

  const conds = [
    isNull(invoicePaymentsTable.voidedAt),
    // Credit-card payments belong on the 1099-K, not the 1099-NEC.
    ne(invoicePaymentsTable.method, "credit_card"),
    // Only count lines explicitly categorized as NEC. (`nec` is the
    // schema default, so historical and untagged labor lines still land
    // here; `misc_*`, `k_third_party_network`, and `none` are excluded.)
    eq(invoiceLinesTable.incomeCategory, "nec"),
    between(
      invoicePaymentsTable.paidAt,
      start,
      new Date(end.getTime() - 1),
    ),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.payerPartnerId)
    conds.push(eq(invoicesTable.partnerId, args.payerPartnerId));

  // Apportion each NEC line's amount by the share of the invoice total
  // covered by this payment, mirroring misc1099. A naive
  // SUM(payments.amount) would double-count whenever an invoice has more
  // than one line.
  const raw: RawAgg[] = await db
    .select({
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      federalTaxId: vendorsTable.federalTaxId,
      vendorAddress: sql<string | null>`COALESCE(${vendorsTable.billingAddress}, ${vendorsTable.physicalAddress})`,
      payerPartnerId: invoicesTable.partnerId,
      payerPartnerName: partnersTable.name,
      payerEin: partnersTable.federalTaxId,
      payerAddress: partnersTable.billingAddress,
      totalPaid: sql<string>`
        COALESCE(SUM(
          ${invoiceLinesTable.amount}::numeric
            * CASE
                WHEN ${invoicesTable.total}::numeric > 0
                THEN LEAST(${invoicePaymentsTable.amount}::numeric, ${invoicesTable.total}::numeric)
                     / ${invoicesTable.total}::numeric
                ELSE 0
              END
        ), 0)::numeric(14,2)
      `,
    })
    .from(invoicePaymentsTable)
    .innerJoin(
      invoicesTable,
      eq(invoicesTable.id, invoicePaymentsTable.invoiceId),
    )
    .innerJoin(
      invoiceLinesTable,
      eq(invoiceLinesTable.invoiceId, invoicesTable.id),
    )
    .innerJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .innerJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .where(and(...conds))
    .groupBy(
      invoicesTable.vendorId,
      vendorsTable.name,
      vendorsTable.federalTaxId,
      vendorsTable.billingAddress,
      vendorsTable.physicalAddress,
      invoicesTable.partnerId,
      partnersTable.name,
      partnersTable.federalTaxId,
      partnersTable.billingAddress,
    );

  const filtered = raw.filter((r) => Number(r.totalPaid) >= threshold);

  // EIN duplicate detection — flag rows whose EIN appears more than once
  // (across different vendor IDs).
  const einCounts = new Map<string, Set<number>>();
  for (const r of filtered) {
    if (!r.federalTaxId) continue;
    const set = einCounts.get(r.federalTaxId) ?? new Set();
    set.add(r.vendorId);
    einCounts.set(r.federalTaxId, set);
  }

  return filtered
    .map((r) => ({
      ...r,
      sharedEinWarning:
        r.federalTaxId != null &&
        (einCounts.get(r.federalTaxId)?.size ?? 0) > 1,
    }))
    .sort((a, b) => Number(b.totalPaid) - Number(a.totalPaid));
}

/** Pure, testable threshold filter. */
export function applyThreshold(
  rows: Array<{ totalPaid: string }>,
  threshold = NEC_THRESHOLD_USD,
): typeof rows {
  return rows.filter((r) => Number(r.totalPaid) >= threshold);
}
