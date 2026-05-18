// A/R aging buckets. Reuses calcDaysPastDueUTC from the aging worker so the
// reports tab and the daily worker agree on what "30 days past due" means.
//
// Buckets: current (not yet due), 1-15, 16-30, 31-60, 60+. The `current`
// bucket also includes invoices with no due_date set (treated as not yet due
// for reporting purposes — they haven't been sent).

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  partnersTable,
  vendorsTable,
} from "@workspace/db";
import { calcDaysPastDueUTC } from "../invoice-aging-worker";
import { toFixedUnits, unitsToString2 } from "../invoice-engine";

export type AgingBucket =
  | "current"
  | "1_15"
  | "16_30"
  | "31_60"
  | "60_plus";

export const AGING_BUCKETS: AgingBucket[] = [
  "current",
  "1_15",
  "16_30",
  "31_60",
  "60_plus",
];

export function bucketForDaysPastDue(d: number): AgingBucket {
  if (d <= 0) return "current";
  if (d <= 15) return "1_15";
  if (d <= 30) return "16_30";
  if (d <= 60) return "31_60";
  return "60_plus";
}

export interface AgingRow {
  partnerId?: number;
  partnerName?: string | null;
  vendorId?: number;
  vendorName?: string | null;
  current: string;
  bucket1_15: string;
  bucket16_30: string;
  bucket31_60: string;
  bucket60_plus: string;
  total: string;
}

interface RawInvoice {
  id: number;
  invoiceNumber: string;
  total: string;
  paidAmount: string;
  creditedAmount: string;
  dueDate: Date | null;
  partnerId: number;
  partnerName: string | null;
  vendorId: number;
  vendorName: string | null;
}

async function fetchOpenInvoices(args: {
  vendorId?: number;
  partnerId?: number;
  asOf: Date;
}): Promise<RawInvoice[]> {
  const conds = [
    inArray(invoicesTable.status, ["open", "sent", "overdue"]),
    sql`(${invoicesTable.total}::numeric - ${invoicesTable.paidAmount}::numeric - ${invoicesTable.creditedAmount}::numeric) > 0`,
  ];
  if (args.vendorId) conds.push(eq(invoicesTable.vendorId, args.vendorId));
  if (args.partnerId) conds.push(eq(invoicesTable.partnerId, args.partnerId));

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      total: invoicesTable.total,
      paidAmount: invoicesTable.paidAmount,
      creditedAmount: invoicesTable.creditedAmount,
      dueDate: invoicesTable.dueDate,
      partnerId: invoicesTable.partnerId,
      partnerName: partnersTable.name,
      vendorId: invoicesTable.vendorId,
      vendorName: vendorsTable.name,
    })
    .from(invoicesTable)
    .leftJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .where(and(...conds));

  return rows;
}

interface BucketAccumulator {
  current: bigint;
  b1_15: bigint;
  b16_30: bigint;
  b31_60: bigint;
  b60_plus: bigint;
}

function emptyAcc(): BucketAccumulator {
  return { current: 0n, b1_15: 0n, b16_30: 0n, b31_60: 0n, b60_plus: 0n };
}

function balanceUnits(r: RawInvoice): bigint {
  const u =
    toFixedUnits(r.total) -
    toFixedUnits(r.paidAmount) -
    toFixedUnits(r.creditedAmount);
  return u < 0n ? 0n : u;
}

function addToBucket(
  acc: BucketAccumulator,
  bucket: AgingBucket,
  amount: bigint,
): void {
  switch (bucket) {
    case "current":
      acc.current += amount;
      break;
    case "1_15":
      acc.b1_15 += amount;
      break;
    case "16_30":
      acc.b16_30 += amount;
      break;
    case "31_60":
      acc.b31_60 += amount;
      break;
    case "60_plus":
      acc.b60_plus += amount;
      break;
  }
}

function totalUnits(acc: BucketAccumulator): bigint {
  return acc.current + acc.b1_15 + acc.b16_30 + acc.b31_60 + acc.b60_plus;
}

function rowFromAcc(
  acc: BucketAccumulator,
  extras: Partial<AgingRow> = {},
): AgingRow {
  return {
    current: unitsToString2(acc.current),
    bucket1_15: unitsToString2(acc.b1_15),
    bucket16_30: unitsToString2(acc.b16_30),
    bucket31_60: unitsToString2(acc.b31_60),
    bucket60_plus: unitsToString2(acc.b60_plus),
    total: unitsToString2(totalUnits(acc)),
    ...extras,
  };
}

/**
 * A/R aging for a single vendor — one row per partner who owes them.
 * `asOf` defaults to "now"; pass a fixed date for snapshot/test.
 */
export async function agingForVendor(
  vendorId: number,
  asOf: Date = new Date(),
): Promise<{ rows: AgingRow[]; totals: AgingRow }> {
  const invs = await fetchOpenInvoices({ vendorId, asOf });
  const byPartner = new Map<number, BucketAccumulator>();
  const partnerNames = new Map<number, string | null>();
  const total = emptyAcc();
  for (const inv of invs) {
    const days = inv.dueDate ? calcDaysPastDueUTC(inv.dueDate, asOf) : 0;
    const bucket = bucketForDaysPastDue(days);
    const bal = balanceUnits(inv);
    const acc = byPartner.get(inv.partnerId) ?? emptyAcc();
    addToBucket(acc, bucket, bal);
    byPartner.set(inv.partnerId, acc);
    partnerNames.set(inv.partnerId, inv.partnerName);
    addToBucket(total, bucket, bal);
  }
  const rows: AgingRow[] = Array.from(byPartner.entries()).map(([pid, acc]) =>
    rowFromAcc(acc, {
      partnerId: pid,
      partnerName: partnerNames.get(pid) ?? null,
    }),
  );
  rows.sort((a, b) => Number(b.total) - Number(a.total));
  return { rows, totals: rowFromAcc(total) };
}

/**
 * A/R aging for a single partner — one row per vendor they owe.
 */
export async function agingForPartner(
  partnerId: number,
  asOf: Date = new Date(),
): Promise<{ rows: AgingRow[]; totals: AgingRow }> {
  const invs = await fetchOpenInvoices({ partnerId, asOf });
  const byVendor = new Map<number, BucketAccumulator>();
  const vendorNames = new Map<number, string | null>();
  const total = emptyAcc();
  for (const inv of invs) {
    const days = inv.dueDate ? calcDaysPastDueUTC(inv.dueDate, asOf) : 0;
    const bucket = bucketForDaysPastDue(days);
    const bal = balanceUnits(inv);
    const acc = byVendor.get(inv.vendorId) ?? emptyAcc();
    addToBucket(acc, bucket, bal);
    byVendor.set(inv.vendorId, acc);
    vendorNames.set(inv.vendorId, inv.vendorName);
    addToBucket(total, bucket, bal);
  }
  const rows: AgingRow[] = Array.from(byVendor.entries()).map(([vid, acc]) =>
    rowFromAcc(acc, {
      vendorId: vid,
      vendorName: vendorNames.get(vid) ?? null,
    }),
  );
  rows.sort((a, b) => Number(b.total) - Number(a.total));
  return { rows, totals: rowFromAcc(total) };
}
