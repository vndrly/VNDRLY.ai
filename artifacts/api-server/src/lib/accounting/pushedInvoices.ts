// Tracks which invoices have already been pushed to a remote
// accounting system (QuickBooks Online or OpenAccountant) so that
// re-running "Sync to QuickBooks" / "Sync to OpenAccountant" against
// the same period skips invoices that were already pushed instead of
// duplicating them.
//
// The push helpers (`pushBundleToQbo`, `pushBundleToOa`) accept a
// `PushedInvoiceStore` so they can both check and record entries
// without coupling to the database. `loadPushedInvoiceStore` is the
// production implementation backed by the `accounting_pushed_invoices`
// table; `inMemoryPushedInvoiceStore` is provided for tests.

import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  accountingPushedInvoicesTable,
  type AccountingProvider,
} from "@workspace/db";

export interface PushedInvoiceRecord {
  invoiceNumber: string;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
}

export interface PushedInvoiceStore {
  /** True if the invoice has already been pushed in a previous sync. */
  has(invoiceNumber: string): boolean;
  /** Idempotently record that an invoice has just been pushed. */
  record(rec: PushedInvoiceRecord): Promise<void>;
}

/** Snapshot of a single push mapping row. Returned by
 *  `getPushedInvoice` so the per-invoice "Re-sync" route can look up the
 *  remote primary key it needs to send a sparse-update / PUT. */
export interface PushedInvoiceLookup {
  vendorId: number;
  provider: AccountingProvider;
  invoiceNumber: string;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
  pushedAt: Date;
}

/** Load a single (vendor, provider, invoiceNumber) mapping row, or null
 *  if this invoice has never been pushed for this provider. */
export async function getPushedInvoice(
  vendorId: number,
  provider: AccountingProvider,
  invoiceNumber: string,
): Promise<PushedInvoiceLookup | null> {
  const rows = await db
    .select({
      vendorId: accountingPushedInvoicesTable.vendorId,
      provider: accountingPushedInvoicesTable.provider,
      invoiceNumber: accountingPushedInvoicesTable.invoiceNumber,
      externalInvoiceId: accountingPushedInvoicesTable.externalInvoiceId,
      externalDocNumber: accountingPushedInvoicesTable.externalDocNumber,
      pushedAt: accountingPushedInvoicesTable.pushedAt,
    })
    .from(accountingPushedInvoicesTable)
    .where(
      and(
        eq(accountingPushedInvoicesTable.vendorId, vendorId),
        eq(accountingPushedInvoicesTable.provider, provider),
        eq(accountingPushedInvoicesTable.invoiceNumber, invoiceNumber),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    vendorId: r.vendorId,
    provider: r.provider as AccountingProvider,
    invoiceNumber: r.invoiceNumber,
    externalInvoiceId: r.externalInvoiceId,
    externalDocNumber: r.externalDocNumber,
    pushedAt: r.pushedAt,
  };
}

/** List every push mapping row for a single invoice, across both
 *  providers. Used by the invoice-detail GET so the UI can show which
 *  remotes the invoice is currently mapped into. */
export async function listPushedInvoicesForNumber(
  vendorId: number,
  invoiceNumber: string,
): Promise<PushedInvoiceLookup[]> {
  const rows = await db
    .select({
      vendorId: accountingPushedInvoicesTable.vendorId,
      provider: accountingPushedInvoicesTable.provider,
      invoiceNumber: accountingPushedInvoicesTable.invoiceNumber,
      externalInvoiceId: accountingPushedInvoicesTable.externalInvoiceId,
      externalDocNumber: accountingPushedInvoicesTable.externalDocNumber,
      pushedAt: accountingPushedInvoicesTable.pushedAt,
    })
    .from(accountingPushedInvoicesTable)
    .where(
      and(
        eq(accountingPushedInvoicesTable.vendorId, vendorId),
        eq(accountingPushedInvoicesTable.invoiceNumber, invoiceNumber),
      ),
    );
  return rows.map((r) => ({
    vendorId: r.vendorId,
    provider: r.provider as AccountingProvider,
    invoiceNumber: r.invoiceNumber,
    externalInvoiceId: r.externalInvoiceId,
    externalDocNumber: r.externalDocNumber,
    pushedAt: r.pushedAt,
  }));
}

/** Delete a single (vendor, provider, invoiceNumber) mapping row.
 *  Returns the deleted row's snapshot (so the caller can audit-log
 *  what was forgotten — remote IDs especially), or null if no row
 *  matched. Idempotent: a no-op delete returns null and the caller
 *  should treat that as a 404. */
export async function deletePushedInvoice(
  vendorId: number,
  provider: AccountingProvider,
  invoiceNumber: string,
): Promise<PushedInvoiceLookup | null> {
  const rows = await db
    .delete(accountingPushedInvoicesTable)
    .where(
      and(
        eq(accountingPushedInvoicesTable.vendorId, vendorId),
        eq(accountingPushedInvoicesTable.provider, provider),
        eq(accountingPushedInvoicesTable.invoiceNumber, invoiceNumber),
      ),
    )
    .returning({
      vendorId: accountingPushedInvoicesTable.vendorId,
      provider: accountingPushedInvoicesTable.provider,
      invoiceNumber: accountingPushedInvoicesTable.invoiceNumber,
      externalInvoiceId: accountingPushedInvoicesTable.externalInvoiceId,
      externalDocNumber: accountingPushedInvoicesTable.externalDocNumber,
      pushedAt: accountingPushedInvoicesTable.pushedAt,
    });
  const r = rows[0];
  if (!r) return null;
  return {
    vendorId: r.vendorId,
    provider: r.provider as AccountingProvider,
    invoiceNumber: r.invoiceNumber,
    externalInvoiceId: r.externalInvoiceId,
    externalDocNumber: r.externalDocNumber,
    pushedAt: r.pushedAt,
  };
}

/** Bump `pushed_at` to now and overwrite the external_doc_number /
 *  external_invoice_id on an existing mapping row. Used by the
 *  per-invoice "Re-sync" action after a successful sparse-update / PUT.
 *
 *  Idempotent: if no row exists yet (e.g. mapping was deleted), this
 *  inserts a new one so the caller's audit trail stays consistent. */
export async function touchPushedInvoice(
  vendorId: number,
  provider: AccountingProvider,
  rec: PushedInvoiceRecord,
): Promise<void> {
  await db
    .insert(accountingPushedInvoicesTable)
    .values({
      vendorId,
      provider,
      invoiceNumber: rec.invoiceNumber,
      externalInvoiceId: rec.externalInvoiceId,
      externalDocNumber: rec.externalDocNumber,
    })
    .onConflictDoUpdate({
      target: [
        accountingPushedInvoicesTable.vendorId,
        accountingPushedInvoicesTable.provider,
        accountingPushedInvoicesTable.invoiceNumber,
      ],
      set: {
        externalInvoiceId: rec.externalInvoiceId,
        externalDocNumber: rec.externalDocNumber,
        pushedAt: new Date(),
      },
    });
}

/** Production-grade store backed by the accounting_pushed_invoices
 *  table. Loads all known invoice numbers up-front so the per-invoice
 *  check is O(1) and we avoid issuing a query per row in the bundle. */
export async function loadPushedInvoiceStore(
  vendorId: number,
  provider: AccountingProvider,
): Promise<PushedInvoiceStore> {
  const rows = await db
    .select({
      invoiceNumber: accountingPushedInvoicesTable.invoiceNumber,
    })
    .from(accountingPushedInvoicesTable)
    .where(
      and(
        eq(accountingPushedInvoicesTable.vendorId, vendorId),
        eq(accountingPushedInvoicesTable.provider, provider),
      ),
    );
  const known = new Set(rows.map((r) => r.invoiceNumber));
  return {
    has: (n) => known.has(n),
    async record(rec) {
      // ON CONFLICT DO NOTHING so concurrent retries are safe and a
      // missing-from-cache row that races us still won't error.
      await db
        .insert(accountingPushedInvoicesTable)
        .values({
          vendorId,
          provider,
          invoiceNumber: rec.invoiceNumber,
          externalInvoiceId: rec.externalInvoiceId,
          externalDocNumber: rec.externalDocNumber,
        })
        .onConflictDoNothing({
          target: [
            accountingPushedInvoicesTable.vendorId,
            accountingPushedInvoicesTable.provider,
            accountingPushedInvoicesTable.invoiceNumber,
          ],
        });
      known.add(rec.invoiceNumber);
    },
  };
}

/** Per-provider push status for one invoice, suitable for serializing
 *  to clients that want to display "Pushed to QuickBooks" / "Pushed to
 *  OpenAccountant" indicators next to invoice rows. */
export interface InvoicePushedStatus {
  pushedAt: string;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
}

export interface InvoicePushedStatusByProvider {
  qbo: InvoicePushedStatus | null;
  oa: InvoicePushedStatus | null;
}

/** Bulk-fetch push status for a list of (vendor, invoice number) pairs
 *  with a single round-trip. The natural key on
 *  accounting_pushed_invoices is (vendor_id, provider, invoice_number),
 *  so we match per-vendor sets of invoice numbers using inArray and OR
 *  the per-vendor predicates together. Returns a map keyed by
 *  `${vendorId}:${invoiceNumber}` so callers can join in-process
 *  without an N+1 query. */
export async function loadPushedStatusForInvoices(
  pairs: ReadonlyArray<{ vendorId: number; invoiceNumber: string }>,
): Promise<Map<string, InvoicePushedStatusByProvider>> {
  const out = new Map<string, InvoicePushedStatusByProvider>();
  if (pairs.length === 0) return out;

  const byVendor = new Map<number, Set<string>>();
  for (const p of pairs) {
    let set = byVendor.get(p.vendorId);
    if (!set) {
      set = new Set();
      byVendor.set(p.vendorId, set);
    }
    set.add(p.invoiceNumber);
  }

  const perVendorConds = Array.from(byVendor.entries()).map(([vid, set]) =>
    and(
      eq(accountingPushedInvoicesTable.vendorId, vid),
      inArray(accountingPushedInvoicesTable.invoiceNumber, Array.from(set)),
    ),
  );
  const where =
    perVendorConds.length === 1 ? perVendorConds[0] : or(...perVendorConds);

  const rows = await db
    .select({
      vendorId: accountingPushedInvoicesTable.vendorId,
      provider: accountingPushedInvoicesTable.provider,
      invoiceNumber: accountingPushedInvoicesTable.invoiceNumber,
      externalInvoiceId: accountingPushedInvoicesTable.externalInvoiceId,
      externalDocNumber: accountingPushedInvoicesTable.externalDocNumber,
      pushedAt: accountingPushedInvoicesTable.pushedAt,
    })
    .from(accountingPushedInvoicesTable)
    .where(where);

  for (const r of rows) {
    const key = `${r.vendorId}:${r.invoiceNumber}`;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { qbo: null, oa: null };
      out.set(key, bucket);
    }
    const status: InvoicePushedStatus = {
      pushedAt: r.pushedAt.toISOString(),
      externalInvoiceId: r.externalInvoiceId,
      externalDocNumber: r.externalDocNumber,
    };
    if (r.provider === "qbo") bucket.qbo = status;
    else if (r.provider === "oa") bucket.oa = status;
  }
  return out;
}

/** In-memory implementation for unit tests. */
export function inMemoryPushedInvoiceStore(
  initial: Iterable<string> = [],
): PushedInvoiceStore {
  const set = new Set<string>(initial);
  return {
    has: (n) => set.has(n),
    async record(rec) {
      set.add(rec.invoiceNumber);
    },
  };
}
