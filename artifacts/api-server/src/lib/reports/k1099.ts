// 1099-K aggregation. The 1099-K is the form Third-Party Settlement
// Organizations (TPSOs) — credit-card processors, payment apps — file
// for each payee whose gross payments through their network exceeded
// the IRS threshold for the year. We treat any invoice_payment with
// method = 'credit_card' as a TPSO payment. (When VNDRLY adds Stripe
// as a true settlement, it will already report through Stripe; this
// report is for partners who run their own card processing through
// VNDRLY-recorded payments.)
//
// Threshold history:
//   2023 and earlier: $20,000 AND 200 transactions
//   2024:             $5,000  (no transaction count)  — IRS phase-in
//   2025:             $2,500
//   2026 and later:   $600    (matches NEC)
//
// We expose K_THRESHOLDS_BY_YEAR so this stays accurate as the rules
// settle, and default to the lowest applicable for the requested year.

import { and, between, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  vendorsTable,
  partnersTable,
} from "@workspace/db";

export const K_THRESHOLDS_BY_YEAR: Record<number, number> = {
  2023: 20000,
  2024: 5000,
  2025: 2500,
  2026: 600,
};

/** IRS minimum number of transactions (only enforced through 2023). */
export const K_TXN_COUNT_THRESHOLD_PRE_2024 = 200;

export function thresholdForYear(year: number): number {
  if (year >= 2026) return 600;
  if (year >= 2025) return 2500;
  if (year >= 2024) return 5000;
  return 20000;
}

export interface K1099Row {
  vendorId: number;
  vendorName: string;
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  /** Box 1a — Gross payment card / TPSO transactions for the year. */
  grossAmount: string;
  /** Box 3 — Number of payment transactions. */
  transactionCount: number;
  /** Box 5a-5l — Monthly breakout (Jan…Dec). */
  monthly: string[];
  /**
   * Index (0-11) of the calendar month in which the running year-to-date
   * total of monthly amounts first reached the active IRS threshold for
   * the year. `null` if no month crosses (e.g. a `threshold` override
   * that is higher than the row's gross). The row-level filter normally
   * guarantees a non-null value, but the field is nullable so callers
   * can render defensively.
   */
  crossedAtMonthIdx: number | null;
  sharedEinWarning: boolean;
}

interface RawK {
  vendorId: number;
  vendorName: string;
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  monthIdx: number;
  amount: string;
  txnCount: number;
}

export async function k1099Rows(args: {
  year: number;
  vendorId?: number;
  payerPartnerId?: number;
  /** Override threshold for testing or partner-specific arrangements. */
  threshold?: number;
}): Promise<K1099Row[]> {
  const start = new Date(Date.UTC(args.year, 0, 1));
  const end = new Date(Date.UTC(args.year + 1, 0, 1));
  const threshold = args.threshold ?? thresholdForYear(args.year);

  const conds = [
    isNull(invoicePaymentsTable.voidedAt),
    eq(invoicePaymentsTable.method, "credit_card"),
    between(
      invoicePaymentsTable.paidAt,
      start,
      new Date(end.getTime() - 1),
    ),
    // Mirror the client-side routing contract (artifacts/vndrly/src/lib/
    // form1099.ts): a credit-card payment only contributes to 1099-K when
    // the underlying invoice has at least one line categorized as `nec`
    // (split off NEC for card share) or `k_third_party_network`. A pure
    // MISC invoice paid by card stays on 1099-MISC and does not appear
    // here, matching the locked client-side helper. Without this filter
    // the same dollars would be reported on both MISC and K for the same
    // recipient.
    sql`EXISTS (
      SELECT 1 FROM ${invoiceLinesTable}
      WHERE ${invoiceLinesTable.invoiceId} = ${invoicesTable.id}
        AND ${invoiceLinesTable.incomeCategory} IN ('nec', 'k_third_party_network')
    )`,
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.payerPartnerId)
    conds.push(eq(invoicesTable.partnerId, args.payerPartnerId));

  // SUM by month so the form's monthly box-out (5a-5l) is accurate.
  const raw: RawK[] = await db
    .select({
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      federalTaxId: vendorsTable.federalTaxId,
      vendorAddress: sql<string | null>`COALESCE(${vendorsTable.billingAddress}, ${vendorsTable.physicalAddress})`,
      payerPartnerId: invoicesTable.partnerId,
      payerPartnerName: partnersTable.name,
      payerEin: partnersTable.federalTaxId,
      payerAddress: partnersTable.billingAddress,
      monthIdx: sql<number>`(EXTRACT(MONTH FROM ${invoicePaymentsTable.paidAt} AT TIME ZONE 'UTC') - 1)::int`,
      amount: sql<string>`COALESCE(SUM(${invoicePaymentsTable.amount}::numeric), 0)::numeric(14,2)`,
      txnCount: sql<number>`COUNT(*)::int`,
    })
    .from(invoicePaymentsTable)
    .innerJoin(
      invoicesTable,
      eq(invoicesTable.id, invoicePaymentsTable.invoiceId),
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
      sql`(EXTRACT(MONTH FROM ${invoicePaymentsTable.paidAt} AT TIME ZONE 'UTC') - 1)::int`,
    );

  return rollupK(raw, threshold, args.year);
}

/**
 * Pure rollup — exposed for tests. Aggregates per-month rows into one
 * row per (vendor, payer) and applies the threshold (and pre-2024 txn
 * count rule).
 */
export function rollupK(
  raw: RawK[],
  threshold: number,
  year: number,
): K1099Row[] {
  const grouped = new Map<string, K1099Row>();
  for (const r of raw) {
    const k = `${r.vendorId}:${r.payerPartnerId}`;
    let row = grouped.get(k);
    if (!row) {
      row = {
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        federalTaxId: r.federalTaxId,
        vendorAddress: r.vendorAddress,
        payerPartnerId: r.payerPartnerId,
        payerPartnerName: r.payerPartnerName,
        payerEin: r.payerEin,
        payerAddress: r.payerAddress,
        grossAmount: "0.00",
        transactionCount: 0,
        monthly: Array(12).fill("0.00"),
        crossedAtMonthIdx: null,
        sharedEinWarning: false,
      };
      grouped.set(k, row);
    }
    if (r.monthIdx >= 0 && r.monthIdx < 12) {
      row.monthly[r.monthIdx] = (
        Number(row.monthly[r.monthIdx]) + Number(r.amount)
      ).toFixed(2);
    }
    row.grossAmount = (Number(row.grossAmount) + Number(r.amount)).toFixed(2);
    row.transactionCount += r.txnCount;
  }

  const enforceTxnCount = year < 2024;
  const filtered: K1099Row[] = [];
  for (const row of grouped.values()) {
    if (Number(row.grossAmount) < threshold) continue;
    if (enforceTxnCount && row.transactionCount < K_TXN_COUNT_THRESHOLD_PRE_2024)
      continue;
    // Walk months in order, find the first one where the running YTD
    // total reaches `threshold`. That's the month the vendor became
    // reportable on this year's 1099-K.
    let ytd = 0;
    for (let i = 0; i < row.monthly.length; i++) {
      ytd += Number(row.monthly[i]);
      if (ytd >= threshold) {
        row.crossedAtMonthIdx = i;
        break;
      }
    }
    filtered.push(row);
  }

  const einCounts = new Map<string, Set<number>>();
  for (const r of filtered) {
    if (!r.federalTaxId) continue;
    const set = einCounts.get(r.federalTaxId) ?? new Set();
    set.add(r.vendorId);
    einCounts.set(r.federalTaxId, set);
  }
  for (const r of filtered) {
    r.sharedEinWarning =
      r.federalTaxId != null &&
      (einCounts.get(r.federalTaxId)?.size ?? 0) > 1;
  }

  filtered.sort((a, b) => Number(b.grossAmount) - Number(a.grossAmount));
  return filtered;
}
