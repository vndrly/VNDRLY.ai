// 1099-MISC aggregation. Unlike 1099-NEC (single Box 1 figure per
// recipient), MISC has multiple boxes with different reporting thresholds:
//
//   Box 1  Rents              ≥ $600
//   Box 2  Royalties          ≥ $10
//   Box 3  Other income       ≥ $600
//   Box 6  Medical/health     ≥ $600
//   Box 7  Direct sales 5k+   not modeled here (rare)
//   Box 10 Gross to attorney  ≥ $600
//   Box 14 Excess golden parachute / other (out of scope)
//
// We map invoice_lines.income_category → boxes and then SUM the line
// amount across every non-voided payment that pays the parent invoice
// (proportionally by paid_amount / total). The proportional split is
// the conservative reading of IRS instructions: only paid amounts
// belong on the 1099, but the *category* is on the line.

import { and, between, eq, isNull, inArray, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  vendorsTable,
  partnersTable,
} from "@workspace/db";

export const MISC_BOX_THRESHOLDS = {
  rents: 600,
  royalties: 10,
  otherIncome: 600,
  medicalHealth: 600,
  attorney: 600,
  prizesAwards: 600,
} as const;

export interface Misc1099BoxAmounts {
  box1Rents: string;
  box2Royalties: string;
  box3OtherIncome: string;
  box3PrizesAwards: string;
  box6MedicalHealth: string;
  box10Attorney: string;
}

export interface Misc1099Row extends Misc1099BoxAmounts {
  vendorId: number;
  vendorName: string;
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  /** Sum of all populated boxes — convenience for sorting/dashboard. */
  totalReportable: string;
  sharedEinWarning: boolean;
}

interface RawMiscAgg {
  vendorId: number;
  vendorName: string;
  federalTaxId: string | null;
  vendorAddress: string | null;
  payerPartnerId: number;
  payerPartnerName: string;
  payerEin: string | null;
  payerAddress: string | null;
  incomeCategory: string;
  amount: string;
}

const MISC_CATEGORIES = [
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
];

export async function misc1099Rows(args: {
  year: number;
  vendorId?: number;
  payerPartnerId?: number;
}): Promise<Misc1099Row[]> {
  const start = new Date(Date.UTC(args.year, 0, 1));
  const end = new Date(Date.UTC(args.year + 1, 0, 1));

  const conds = [
    isNull(invoicePaymentsTable.voidedAt),
    between(
      invoicePaymentsTable.paidAt,
      start,
      new Date(end.getTime() - 1),
    ),
    inArray(invoiceLinesTable.incomeCategory, MISC_CATEGORIES),
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.payerPartnerId)
    conds.push(eq(invoicesTable.partnerId, args.payerPartnerId));

  // Each invoice line's contribution to the recipient's MISC totals is
  // line.amount * (sum_payments / invoice.total). We accomplish this in
  // SQL with a window-style sum scaled by the proportion of paid_amount /
  // invoice total. A naive SUM(payments.amount) would over-count when
  // an invoice has multiple lines.
  const raw: RawMiscAgg[] = await db
    .select({
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
      federalTaxId: vendorsTable.federalTaxId,
      vendorAddress: sql<string | null>`COALESCE(${vendorsTable.billingAddress}, ${vendorsTable.physicalAddress})`,
      payerPartnerId: invoicesTable.partnerId,
      payerPartnerName: partnersTable.name,
      payerEin: partnersTable.federalTaxId,
      payerAddress: partnersTable.billingAddress,
      incomeCategory: invoiceLinesTable.incomeCategory,
      amount: sql<string>`
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
      invoiceLinesTable.incomeCategory,
    );

  return rollupMisc(raw);
}

interface RollupGroupKey {
  vendorId: number;
  payerPartnerId: number;
}

/**
 * Pure rollup — exposed for tests. Takes raw category-level rows and
 * produces one row per (vendor, payer) with each box populated, then
 * filters by per-box thresholds.
 */
export function rollupMisc(raw: RawMiscAgg[]): Misc1099Row[] {
  const grouped = new Map<string, Misc1099Row>();
  const keyOf = (k: RollupGroupKey): string =>
    `${k.vendorId}:${k.payerPartnerId}`;

  for (const r of raw) {
    const k = keyOf(r);
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
        box1Rents: "0.00",
        box2Royalties: "0.00",
        box3OtherIncome: "0.00",
        box3PrizesAwards: "0.00",
        box6MedicalHealth: "0.00",
        box10Attorney: "0.00",
        totalReportable: "0.00",
        sharedEinWarning: false,
      };
      grouped.set(k, row);
    }
    switch (r.incomeCategory) {
      case "misc_rents":
        row.box1Rents = addStr(row.box1Rents, r.amount);
        break;
      case "misc_royalties":
        row.box2Royalties = addStr(row.box2Royalties, r.amount);
        break;
      case "misc_other_income":
        row.box3OtherIncome = addStr(row.box3OtherIncome, r.amount);
        break;
      case "misc_prizes_awards":
        row.box3PrizesAwards = addStr(row.box3PrizesAwards, r.amount);
        break;
      case "misc_medical_health":
        row.box6MedicalHealth = addStr(row.box6MedicalHealth, r.amount);
        break;
      case "misc_attorney":
        row.box10Attorney = addStr(row.box10Attorney, r.amount);
        break;
    }
  }

  // Per-box thresholds, then sum into totalReportable.
  const filtered: Misc1099Row[] = [];
  for (const row of grouped.values()) {
    if (Number(row.box1Rents) < MISC_BOX_THRESHOLDS.rents) row.box1Rents = "0.00";
    if (Number(row.box2Royalties) < MISC_BOX_THRESHOLDS.royalties)
      row.box2Royalties = "0.00";
    if (Number(row.box3OtherIncome) < MISC_BOX_THRESHOLDS.otherIncome)
      row.box3OtherIncome = "0.00";
    if (Number(row.box3PrizesAwards) < MISC_BOX_THRESHOLDS.prizesAwards)
      row.box3PrizesAwards = "0.00";
    if (Number(row.box6MedicalHealth) < MISC_BOX_THRESHOLDS.medicalHealth)
      row.box6MedicalHealth = "0.00";
    if (Number(row.box10Attorney) < MISC_BOX_THRESHOLDS.attorney)
      row.box10Attorney = "0.00";

    const total =
      Number(row.box1Rents) +
      Number(row.box2Royalties) +
      Number(row.box3OtherIncome) +
      Number(row.box3PrizesAwards) +
      Number(row.box6MedicalHealth) +
      Number(row.box10Attorney);
    row.totalReportable = total.toFixed(2);
    if (total > 0) filtered.push(row);
  }

  // EIN warning across distinct vendors with the same EIN.
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

  filtered.sort(
    (a, b) => Number(b.totalReportable) - Number(a.totalReportable),
  );
  return filtered;
}

function addStr(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2);
}
