import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { and, eq, desc, inArray, isNull, sql, gte, lt } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  invoiceTicketLinksTable,
  invoiceRateCardSnapshotsTable,
  invoicePaymentsTable,
  invoicePaymentAuditLogTable,
  invoiceCreditMemosTable,
  invoiceSendLogTable,
  invoiceReminderLogTable,
  vendorPartnerBillingSettingsTable,
  vendorsTable,
  partnersTable,
  accountingPushedInvoicesTable,
  invoiceLineCategoryBackfillAuditLogTable,
  invoiceLineCategoryAuditTable,
  usersTable,
  PAYMENT_METHODS,
  INVOICE_LINE_INCOME_CATEGORIES,
  INVOICE_LINE_TYPES,
  ACCOUNTING_PROVIDERS,
  type Invoice,
  type InvoiceLineType,
  type InvoiceLineIncomeCategory,
  type IncomeCategoryOverrideMap,
  type AccountingProvider,
} from "@workspace/db";
import {
  UpdateVendorPartnerBillingSettingsBody,
  UpdateInvoiceLateFeeRuleBody,
} from "@workspace/api-zod";
import { getSessionFromRequest as getSession } from "../lib/session";
import {
  computeTargetPeriodForTicket,
  generateInvoiceForTicket,
  runInvoiceGenerationCoalesced,
  type GenerationResult,
} from "../lib/invoice-generator";
import {
  totalLines,
  toFixedUnits,
  unitsToString2,
  mulUnits,
  resolveIncomeCategory,
} from "../lib/invoice-engine";
import { renderInvoicePdf } from "../lib/invoice-pdf";
import { calcDaysPastDueUTC } from "../lib/invoice-aging-worker";
import {
  sendInvoiceEmail,
  sendInvoiceReminderEmail,
} from "../lib/sendgrid";
import {
  findPartnerBillingUserIds,
  findVendorUserIds,
  resolveBillingEmail,
  resolveBillingLocale,
  resolvePartnerSessionLocale,
} from "../lib/invoice-recipients";
import {
  deletePushedInvoice,
  loadPushedStatusForInvoices,
} from "../lib/accounting/pushedInvoices";
import {
  recordExport,
  loadInvoiceResyncHistory,
} from "../lib/reports/audit";
import { notifyUsers } from "./notifications";
import { logger } from "../lib/logger";

import { sendValidationFailed } from "../lib/validation-error";
const router: IRouter = Router();

// ──────────────────────────────────────────────────────────────────
// RBAC helpers
// ──────────────────────────────────────────────────────────────────

function canSeeInvoice(
  session: ReturnType<typeof getSession>,
  invoice: Pick<Invoice, "vendorId" | "partnerId">,
): boolean {
  if (!session) return false;
  if (session.role === "admin") return true;
  if (session.role === "vendor" && session.vendorId === invoice.vendorId) return true;
  if (session.role === "partner" && session.partnerId === invoice.partnerId) return true;
  return false;
}

function canEditInvoice(
  session: ReturnType<typeof getSession>,
  invoice: Pick<Invoice, "vendorId" | "status">,
): boolean {
  if (!session) return false;
  if (invoice.status !== "draft") return false;
  if (session.role === "admin") return true;
  if (session.role === "vendor" && session.vendorId === invoice.vendorId) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────
// GET /invoices — list with filters
// ──────────────────────────────────────────────────────────────────

const ListQuery = z.object({
  vendorId: z.coerce.number().int().optional(),
  partnerId: z.coerce.number().int().optional(),
  // Comma-separated list (e.g. "sent,overdue") OR a single value. Splits and
  // dedupes, then ANDs into the WHERE via inArray. Empty after split → no
  // status filter applied.
  status: z.string().optional(),
  // Exact-match filter on the human-facing invoice number (e.g. "INV-1001").
  // Used by the reconciliation drift UI to resolve a warning's invoice
  // identifier into a numeric id so it can deep-link to the detail page.
  // RBAC scoping above still applies — vendors/partners only see their own.
  invoiceNumber: z.string().min(1).max(64).optional(),
  // Inclusive lower / exclusive upper bound on invoice.period_start.
  // Accepts ISO 8601 (date or datetime). Either may be omitted.
  periodStart: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  periodEnd: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  // Accounting-sync filter, evaluated against accounting_pushed_invoices.
  //   qbo  → only invoices that have been pushed to QuickBooks Online
  //   oa   → only invoices that have been pushed to OpenAccountant
  //   none → only invoices that have NOT been pushed to either provider
  //   any  → no filter (default behaviour, identical to omitting the param)
  // Lets admins quickly find invoices that still need to be pushed (or
  // audit ones already pushed) without eyeballing every row.
  pushed: z.enum(["qbo", "oa", "any", "none"]).optional(),
  // Over-payment filter. When true, restricts the result set to invoices
  // whose recorded paid_amount (already kept in sync with SUM of non-voided
  // payments by the record-payment / void-payment handlers) exceeds the
  // invoice total. Lets the AP dashboard surface refund/void candidates
  // before they show up as a year-end reconciliation surprise.
  overpaid: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
  // When set, GET /invoices skips the row select / pushed-status join and
  // returns just `{ count }` — the SQL COUNT(*) of invoices matching the
  // other filters and RBAC scoping. The invoices page uses this to render
  // a "12 not synced" badge next to the sync filter without paying for
  // (or displaying) the full row payload.
  countOnly: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

router.get("/invoices", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const q = ListQuery.safeParse(req.query);
  if (!q.success) {
    sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
    return;
  }

  const conds: ReturnType<typeof eq>[] = [];

  // RBAC scoping
  if (session.role === "vendor") {
    if (!session.vendorId) {
      res.json({ items: [] });
      return;
    }
    conds.push(eq(invoicesTable.vendorId, session.vendorId));
  } else if (session.role === "partner") {
    if (!session.partnerId) {
      res.json({ items: [] });
      return;
    }
    conds.push(eq(invoicesTable.partnerId, session.partnerId));
  } else if (session.role !== "admin") {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }

  if (q.data.vendorId) conds.push(eq(invoicesTable.vendorId, q.data.vendorId));
  if (q.data.partnerId) conds.push(eq(invoicesTable.partnerId, q.data.partnerId));
  if (q.data.invoiceNumber) {
    conds.push(eq(invoicesTable.invoiceNumber, q.data.invoiceNumber));
  }
  if (q.data.status) {
    const statuses = q.data.status
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) {
      conds.push(eq(invoicesTable.status, statuses[0]));
    } else if (statuses.length > 1) {
      conds.push(inArray(invoicesTable.status, statuses));
    }
  }
  // Period filter: bounds applied against invoice.period_start. Lower bound
  // inclusive, upper bound exclusive — standard half-open interval semantics.
  if (q.data.periodStart) {
    conds.push(gte(invoicesTable.periodStart, new Date(q.data.periodStart)));
  }
  if (q.data.periodEnd) {
    conds.push(lt(invoicesTable.periodStart, new Date(q.data.periodEnd)));
  }
  // Accounting-sync filter. Joining accounting_pushed_invoices on
  // (vendor_id, invoice_number) with a per-row EXISTS / NOT EXISTS lets
  // Postgres use the natural unique index without us having to dedupe
  // hits in-memory, and keeps invoices.* as the only base relation so
  // the row count never blows up when an invoice was pushed to both
  // providers. "any" is intentionally a no-op.
  if (q.data.pushed === "qbo" || q.data.pushed === "oa") {
    const provider = q.data.pushed;
    conds.push(
      sql`exists (
        select 1 from ${accountingPushedInvoicesTable}
        where ${accountingPushedInvoicesTable.vendorId} = ${invoicesTable.vendorId}
          and ${accountingPushedInvoicesTable.invoiceNumber} = ${invoicesTable.invoiceNumber}
          and ${accountingPushedInvoicesTable.provider} = ${provider}
      )`,
    );
  } else if (q.data.pushed === "none") {
    conds.push(
      sql`not exists (
        select 1 from ${accountingPushedInvoicesTable}
        where ${accountingPushedInvoicesTable.vendorId} = ${invoicesTable.vendorId}
          and ${accountingPushedInvoicesTable.invoiceNumber} = ${invoicesTable.invoiceNumber}
      )`,
    );
  }
  // Over-payment filter. paid_amount is maintained as SUM(non-voided
  // payment.amount) by the record-payment and void-payment handlers, so a
  // direct numeric comparison against `total` is sufficient — no extra
  // join into invoice_payments needed. Compared in numeric domain to
  // sidestep the cents-vs-string trap.
  if (q.data.overpaid === true) {
    conds.push(
      sql`${invoicesTable.paidAmount}::numeric > ${invoicesTable.total}::numeric`,
    );
  }

  // Lightweight count path used by the invoices page to render a
  // "N not synced" badge alongside the Sync filter without round-tripping
  // the full invoice payload (or the pushed-status N+1 lookup). Honours
  // the same RBAC scoping and `conds` collected above so an admin
  // narrowing by status sees the count for that narrow set.
  if (q.data.countOnly === true) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable)
      .where(conds.length ? and(...conds) : sql`true`);
    res.json({ count: row?.count ?? 0 });
    return;
  }

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      vendorId: invoicesTable.vendorId,
      partnerId: invoicesTable.partnerId,
      vendorName: vendorsTable.name,
      partnerName: partnersTable.name,
      cadence: invoicesTable.cadence,
      status: invoicesTable.status,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      dueDate: invoicesTable.dueDate,
      subtotal: invoicesTable.subtotal,
      taxTotal: invoicesTable.taxTotal,
      total: invoicesTable.total,
      // Phase 3 balance fields. Bills-to-Pay and other consumers compute
      // outstanding balance as total - paid - credited; these must travel
      // on the list response.
      paidAmount: invoicesTable.paidAmount,
      creditedAmount: invoicesTable.creditedAmount,
      generatedAt: invoicesTable.generatedAt,
      sentAt: invoicesTable.sentAt,
      paidAt: invoicesTable.paidAt,
    })
    .from(invoicesTable)
    .leftJoin(vendorsTable, eq(vendorsTable.id, invoicesTable.vendorId))
    .leftJoin(partnersTable, eq(partnersTable.id, invoicesTable.partnerId))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(q.data.limit);

  // Bulk-fetch per-invoice push status for QuickBooks Online and
  // OpenAccountant in a single query rather than issuing one SELECT per
  // invoice (avoids N+1 on long invoice lists). Empty `pushedTo`
  // buckets default to nulls so the frontend can render unconditionally.
  //
  // Scope note: `pushedTo` is attached for every invoice the caller can
  // already see (admin / owning vendor / partner-on-the-invoice). The
  // values it exposes — push timestamp, remote DocNumber and remote id —
  // are derived from the invoice itself; they are not separately
  // sensitive relative to what the caller already accesses on this row.
  // Vendors trigger the QBO/OA push from the Reports page and therefore
  // benefit from seeing the resulting status on their own invoices.
  const pushStatus = await loadPushedStatusForInvoices(
    rows.map((r) => ({ vendorId: r.vendorId, invoiceNumber: r.invoiceNumber })),
  );

  const items = rows.map((r) => {
    const balU =
      toFixedUnits(r.total) -
      toFixedUnits(r.paidAmount) -
      toFixedUnits(r.creditedAmount);
    // Over-payment surface: when SUM(non-voided payments) — i.e. paid_amount
    // — exceeds the invoice total, finance needs to refund the vendor or
    // void a duplicate payment. We expose both a boolean and the exact
    // amount so the AP dashboard can show a "Possible over-payment" badge
    // and the dollar delta without a second round-trip.
    const overpayU = toFixedUnits(r.paidAmount) - toFixedUnits(r.total);
    return {
      ...r,
      balanceDue: unitsToString2(balU < 0n ? 0n : balU),
      overpaid: overpayU > 0n,
      overpaidAmount: unitsToString2(overpayU > 0n ? overpayU : 0n),
      pushedTo: pushStatus.get(`${r.vendorId}:${r.invoiceNumber}`) ?? {
        qbo: null,
        oa: null,
      },
    };
  });

  res.json({ items });
});

// ──────────────────────────────────────────────────────────────────
// GET /invoices/:id — full detail
// ──────────────────────────────────────────────────────────────────

const IdParams = z.object({ id: z.coerce.number().int() });

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canSeeInvoice(session, invoice)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  // Determine role early so we can skip fetching vendor-internal data for
  // partner callers — reducing both DB load and in-memory exposure.
  const isPartnerViewer = session.role === "partner";

  const lines = await db
    .select()
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, invoice.id))
    .orderBy(invoiceLinesTable.ticketId, invoiceLinesTable.sortOrder);
  const ticketLinks = await db
    .select()
    .from(invoiceTicketLinksTable)
    .where(eq(invoiceTicketLinksTable.invoiceId, invoice.id));

  // Rate-card snapshot history — internal billing data not needed by partners.
  // Only fetch for vendor/admin callers to avoid loading sensitive per-employee
  // rates, overtime multipliers, and tax-rate provenance into memory for
  // partner sessions.
  const snapshotRows = isPartnerViewer
    ? []
    : await db
        .select()
        .from(invoiceRateCardSnapshotsTable)
        .where(eq(invoiceRateCardSnapshotsTable.invoiceId, invoice.id))
        .orderBy(invoiceRateCardSnapshotsTable.capturedAt);
  const latestSnapshot = snapshotRows.length
    ? snapshotRows[snapshotRows.length - 1]
    : null;

  const [vendor] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, invoice.vendorId));
  const [partner] = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.id, invoice.partnerId));

  const payments = await db
    .select()
    .from(invoicePaymentsTable)
    .where(and(eq(invoicePaymentsTable.invoiceId, invoice.id), isNull(invoicePaymentsTable.voidedAt)))
    .orderBy(invoicePaymentsTable.paidAt);
  const credits = await db
    .select()
    .from(invoiceCreditMemosTable)
    .where(eq(invoiceCreditMemosTable.invoiceId, invoice.id))
    .orderBy(invoiceCreditMemosTable.createdAt);

  // Send/reminder audit logs — internal operational records not needed by partners.
  // Skip fetching entirely for partner callers.
  const sendLog = isPartnerViewer
    ? []
    : await db
        .select()
        .from(invoiceSendLogTable)
        .where(eq(invoiceSendLogTable.invoiceId, invoice.id))
        .orderBy(desc(invoiceSendLogTable.sentAt))
        .limit(20);
  const reminderLog = isPartnerViewer
    ? []
    : await db
        .select()
        .from(invoiceReminderLogTable)
        .where(eq(invoiceReminderLogTable.invoiceId, invoice.id))
        .orderBy(desc(invoiceReminderLogTable.sentAt))
        .limit(20);

  const balanceDue = unitsToString2(
    toFixedUnits(invoice.total) -
      toFixedUnits(invoice.paidAmount) -
      toFixedUnits(invoice.creditedAmount),
  );

  // Effective late-fee rule = per-invoice override (if set) ELSE the
  // per-(vendor, partner) default. Surfaced alongside `lateFeeRule` so the
  // UI can show admins what will actually fire when this invoice goes
  // overdue without doing a second round-trip for billing settings. The
  // raw `lateFeeRule` column is preserved in `...invoice` so callers can
  // distinguish "no override, falling back to default" (column null) from
  // "explicitly disabled on this invoice" (column = {kind:"none"}).
  const [billingRow] = await db
    .select({
      lateFeeRule: vendorPartnerBillingSettingsTable.lateFeeRule,
    })
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, invoice.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, invoice.partnerId),
      ),
    );
  const effectiveLateFeeRule =
    invoice.lateFeeRule ?? billingRow?.lateFeeRule ?? null;

  // Per-provider QBO/OA push status and resync audit trail — internal accounting
  // metadata only needed by vendor/admin callers. Skip the DB/API calls entirely
  // for partner sessions to avoid loading accounting-system identifiers into memory.
  const pushedTo = isPartnerViewer
    ? { qbo: null, oa: null }
    : (await loadPushedStatusForInvoices([
        { vendorId: invoice.vendorId, invoiceNumber: invoice.invoiceNumber },
      ])).get(`${invoice.vendorId}:${invoice.invoiceNumber}`) ?? { qbo: null, oa: null };

  // Capped at 10 for vendor/admin; empty for partners (not fetched above).
  const resyncHistory = isPartnerViewer
    ? []
    : await loadInvoiceResyncHistory(invoice.id, 10);

  // Flat envelope: invoice fields at the top level + embedded lines/ticketLinks.
  // Vendor/partner names are namespaced to avoid colliding with invoice scalar fields.
  // Internal operational/accounting fields return safe empty placeholders for partners
  // so the API contract remains stable for client code regardless of caller role.
  res.json({
    ...invoice,
    vendor,
    partner,
    lines,
    ticketLinks,
    payments,
    creditMemos: credits,
    balanceDue,
    effectiveLateFeeRule,
    sendLog,
    reminderLog,
    pushedTo,
    resyncHistory,
    snapshot: latestSnapshot?.snapshot ?? null,
    snapshots: snapshotRows.map((r) => ({
      id: r.id,
      ticketId: r.ticketId,
      capturedAt: r.capturedAt,
      snapshot: r.snapshot,
    })),
  });
});

// ──────────────────────────────────────────────────────────────────
// GET /invoices/:id/resync-history — paginated re-sync audit trail
// ──────────────────────────────────────────────────────────────────
//
// The detail endpoint returns the 10 most recent re-sync events inline
// to keep the payload small. For invoices that have been re-pushed many
// times, admins/vendors page through the older events here using a
// `before=<auditId>` cursor (the smallest id from the previous page).
// Bounded `limit` (1..50, default 20) keeps a single response small.
// Partners are forbidden — re-sync history is internal accounting data.

const ResyncHistoryQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

router.get(
  "/invoices/:id/resync-history",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        error: "Not authenticated",
        code: "auth.not_authenticated",
      });
      return;
    }
    const p = IdParams.safeParse(req.params);
    if (!p.success) {
      sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
      return;
    }
    const q = ResyncHistoryQuery.safeParse(req.query);
    if (!q.success) {
      sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
      return;
    }
    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        vendorId: invoicesTable.vendorId,
        partnerId: invoicesTable.partnerId,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, p.data.id));
    if (!invoice) {
      res
        .status(404)
        .json({ error: "Invoice not found", code: "invoice.not_found" });
      return;
    }
    if (!canSeeInvoice(session, invoice)) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    // Re-sync history mirrors the detail endpoint: partner sessions
    // never see internal accounting metadata, so they get a 403 here
    // rather than an empty page (the detail endpoint hides the section
    // from them entirely, so they should never call this route).
    if (session.role === "partner") {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    // Fetch limit+1 so we can tell whether another page exists without
    // a second COUNT round-trip. The extra row is never returned to the
    // client; its id only seeds the next-page cursor.
    const fetched = await loadInvoiceResyncHistory(invoice.id, {
      limit: q.data.limit + 1,
      beforeId: q.data.before,
    });
    const hasMore = fetched.length > q.data.limit;
    const items = hasMore ? fetched.slice(0, q.data.limit) : fetched;
    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].id : null;
    res.json({ items, nextCursor });
  },
);

// ──────────────────────────────────────────────────────────────────
// PATCH /invoices/:id/late-fee-rule — admin/vendor late-fee override
// ──────────────────────────────────────────────────────────────────
//
// Sets, updates, or clears the per-invoice late-fee policy snapshot. The
// aging worker reads this column first and falls back to the per-(vendor,
// partner) `vendor_partner_billing_settings.late_fee_rule` when this is
// NULL. Sending `lateFeeRule: null` in the body explicitly nulls the
// column (i.e. defer to the vendor default again); sending an explicit
// `{kind:"none"}` overrides the vendor default with "no late fee on this
// invoice".
//
// Authorization mirrors the billing-settings PUT: admin, or the owning
// vendor. Partners cannot edit invoice billing policies. We allow editing
// in any non-cancelled status — the aging worker is idempotent per
// invoice (one late-fee line max), so a late edit either changes future
// behaviour (rule changed before any fee is owed) or is a no-op (a fee
// was already applied; the worker's existence check holds).
router.patch(
  "/invoices/:id/late-fee-rule",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        error: "Not authenticated",
        code: "auth.not_authenticated",
      });
      return;
    }
    const p = IdParams.safeParse(req.params);
    if (!p.success) {
      res.status(400).json({
        error: p.error.message,
        code: "validation.invalid_input",
      });
      return;
    }
    const body = UpdateInvoiceLateFeeRuleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: body.error.message,
        code: "validation.invalid_input",
      });
      return;
    }
    const [invoice] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, p.data.id));
    if (!invoice) {
      res.status(404).json({
        error: "Invoice not found",
        code: "invoice.not_found",
      });
      return;
    }
    if (
      session.role !== "admin" &&
      !(session.role === "vendor" && session.vendorId === invoice.vendorId)
    ) {
      res
        .status(403)
        .json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    if (invoice.status === "cancelled") {
      res.status(409).json({
        error: "Cannot edit late-fee rule on a cancelled invoice",
        code: "invoice.cancelled",
      });
      return;
    }
    await db
      .update(invoicesTable)
      .set({ lateFeeRule: body.data.lateFeeRule })
      .where(eq(invoicesTable.id, invoice.id));
    const [refreshed] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    logger.info(
      {
        invoiceId: invoice.id,
        userId: session.userId,
        lateFeeRule: body.data.lateFeeRule,
      },
      "Invoice late-fee rule updated",
    );
    res.json({ invoice: refreshed });
  },
);

// ──────────────────────────────────────────────────────────────────
// POST /invoices/:id/regenerate — re-run generator over linked tickets
// ──────────────────────────────────────────────────────────────────

router.post("/invoices/:id/regenerate", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canEditInvoice(session, invoice)) {
    res.status(403).json({ error: "Cannot regenerate this invoice", code: "invoice.cannot_regenerate" });
    return;
  }
  const links = await db
    .select()
    .from(invoiceTicketLinksTable)
    .where(eq(invoiceTicketLinksTable.invoiceId, invoice.id));

  // PREFLIGHT: each linked ticket must STILL resolve into the same period
  // tuple as this invoice. If a ticket was reassigned to a different site or
  // the billing cadence changed, regenerating would silently move charges to
  // a different invoice. We refuse with 409 BEFORE writing anything.
  const periodMs = (invoice.periodStart as Date).getTime();
  const wouldMove: {
    ticketId: number;
    reason: string;
    target?: { vendorId: number; partnerId: number; cadence: string; periodStart: string };
  }[] = [];
  for (const link of links) {
    const peek = await computeTargetPeriodForTicket(link.ticketId);
    if (!peek.ok) {
      wouldMove.push({ ticketId: link.ticketId, reason: peek.reason });
      continue;
    }
    const matches =
      peek.vendorId === invoice.vendorId &&
      peek.partnerId === invoice.partnerId &&
      peek.cadence === invoice.cadence &&
      peek.periodStart.getTime() === periodMs;
    if (!matches) {
      wouldMove.push({
        ticketId: link.ticketId,
        reason: "would_resolve_to_different_invoice",
        target: {
          vendorId: peek.vendorId,
          partnerId: peek.partnerId,
          cadence: peek.cadence,
          periodStart: peek.periodStart.toISOString(),
        },
      });
    }
  }
  if (wouldMove.length > 0) {
    res.status(409).json({
      error:
        "Regeneration would move ticket charges to a different invoice (e.g. supplemental, reassigned ticket, or cadence changed). Refusing to silently re-route.",
      code: "invoice.regenerate_would_move",
      tickets: wouldMove,
    });
    return;
  }

  // Defense in depth:
  //  - Cluster-wide serialization: generateInvoiceForTicket acquires a
  //    Postgres advisory lock keyed by ticketId for the duration of its
  //    transaction, so two replicas (or two requests on the same replica)
  //    processing the same ticket take turns instead of racing.
  //  - Per-process coalescing (runInvoiceGenerationCoalesced): saves DB
  //    round-trips when an approve hook and a regenerate click race on
  //    the SAME Node process; not relied on for cluster-wide safety.
  //  - TOCTOU close: pass expectedInvoiceId so if the resolver lands on a
  //    different invoice between our preflight and the actual write (live
  //    data shifted), the generator returns ok:false and writes nothing.
  // Note: runInvoiceGenerationCoalesced reuses any in-flight call regardless
  // of the expectedInvoiceId argument; we therefore call generateInvoiceForTicket
  // directly here so the preflight invariant is always enforced for explicit
  // user-initiated regenerates.
  // ATOMIC REGENERATION: wrap the whole per-ticket loop in a single
  // transaction. If ANY ticket fails (target_changed, etc.) we throw and the
  // database rolls back every line/link/totals/snapshot write performed by
  // earlier tickets in this batch. Without this, a 4-ticket invoice that
  // breaks on ticket #3 would have left tickets #1 and #2 already rewritten
  // with brand-new lines while the user got a 409 — leaving the invoice in
  // an inconsistent half-regenerated state.
  const results: GenerationResult[] = [];
  const targetMismatches: { ticketId: number; reason: string }[] = [];
  const ROLLBACK_SENTINEL = Symbol("regenerate_rollback");
  try {
    await db.transaction(async (tx) => {
      for (const link of links) {
        const r = await generateInvoiceForTicket(
          link.ticketId,
          invoice.id,
          tx,
        );
        results.push(r);
        if (!r.ok && r.reason.startsWith("target_changed:")) {
          targetMismatches.push({ ticketId: link.ticketId, reason: r.reason });
          throw ROLLBACK_SENTINEL;
        }
      }
    });
  } catch (e) {
    if (e !== ROLLBACK_SENTINEL) throw e;
  }
  if (targetMismatches.length > 0) {
    res.status(409).json({
      error:
        "Regeneration aborted because live ticket/billing data shifted between preflight and write. No charges were moved.",
      code: "invoice.regenerate_target_changed",
      tickets: targetMismatches,
    });
    return;
  }
  const [refreshed] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoice.id));
  res.json({ invoice: refreshed, results });
});

// ──────────────────────────────────────────────────────────────────
// PATCH /invoices/:id/lines — bulk update (currently incomeCategory only)
//
// Year-end 1099 cleanup commonly involves recategorizing many lines on a
// single invoice at once (e.g. "all of these are misc_rents not nec").
// Doing it through the per-row PATCH means N round-trips and N transactions,
// which both feels slow to the admin and racks up the manual-override flag
// row by row. This endpoint applies one income category to a vetted list
// of line IDs in a single statement, gated by the same draft-only guard as
// the per-row PATCH so already-sent invoices stay immutable. The lines are
// also flagged as manual overrides so a subsequent regenerate doesn't wipe
// the deliberate categorization.
//
// Two body shapes are accepted:
//   1) { lineIds, incomeCategory }
//      Apply ONE category to many ids. Sets is_manual_override = true.
//   2) { updates: [{ lineId, incomeCategory, isManualOverride? }] }
//      Per-line categories. Used by the client-side Undo affordance to
//      restore each line's prior category (and prior manual-override flag)
//      in a single round-trip after a misclick. is_manual_override is
//      restored to the supplied value when present so undo is a true
//      revert and not just a category change that re-flags the row.
//
// In both cases the response includes `previousCategories` — one entry per
// affected line with the values they HAD before this call ran — so the
// caller can stash them and offer Undo without re-querying.
// ──────────────────────────────────────────────────────────────────

const PatchLinesBulkBody = z.union([
  z.object({
    lineIds: z
      .array(z.coerce.number().int().positive())
      .min(1)
      .max(500),
    incomeCategory: z.enum(INVOICE_LINE_INCOME_CATEGORIES),
  }),
  z.object({
    updates: z
      .array(
        z.object({
          lineId: z.coerce.number().int().positive(),
          incomeCategory: z.enum(INVOICE_LINE_INCOME_CATEGORIES),
          isManualOverride: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
]);

router.patch("/invoices/:id/lines", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = IdParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const body = PatchLinesBulkBody.safeParse(req.body);
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canEditInvoice(session, invoice)) {
    res.status(403).json({ error: "Cannot edit this invoice", code: "invoice.cannot_edit" });
    return;
  }

  // Normalize both body shapes into a per-line plan: { lineId, category,
  // setManualOverride }. The single-category shape always sets the manual
  // override flag (deliberate user choice); the per-line shape lets the
  // caller restore the prior flag when undoing.
  type Plan = {
    lineId: number;
    category: InvoiceLineIncomeCategory;
    setManualOverride: boolean;
  };
  let plan: Plan[];
  if ("lineIds" in body.data) {
    // Hoist into locals so the narrowed type survives the closure below
    // (TS doesn't always preserve a `key in union` narrowing inside .map).
    const { lineIds, incomeCategory } = body.data;
    const uniqueIds = Array.from(new Set(lineIds));
    plan = uniqueIds.map((lineId) => ({
      lineId,
      category: incomeCategory,
      setManualOverride: true,
    }));
  } else {
    // Dedupe by lineId, last one wins — matches how a hand-authored undo
    // payload would be applied, and avoids issuing duplicate updates.
    const byId = new Map<number, Plan>();
    for (const u of body.data.updates) {
      byId.set(u.lineId, {
        lineId: u.lineId,
        category: u.incomeCategory,
        // Default to true to preserve the historical behavior of any
        // caller that omits the flag. Undo callers will explicitly pass
        // the prior value (often false).
        setManualOverride: u.isManualOverride ?? true,
      });
    }
    plan = Array.from(byId.values());
  }
  const uniqueIds = plan.map((p) => p.lineId);

  // Ownership check: every requested id must belong to THIS invoice. We
  // refuse the whole batch if any id is foreign so an attacker can't piggy-
  // back ids from an invoice they can't edit onto a request they can.
  // Capture the prior category + override flag at the same time so we can
  // hand them back to the caller for Undo.
  const matched = await db
    .select({
      id: invoiceLinesTable.id,
      incomeCategory: invoiceLinesTable.incomeCategory,
      isManualOverride: invoiceLinesTable.isManualOverride,
    })
    .from(invoiceLinesTable)
    .where(
      and(
        eq(invoiceLinesTable.invoiceId, invoice.id),
        inArray(invoiceLinesTable.id, uniqueIds),
      ),
    );
  if (matched.length !== uniqueIds.length) {
    res.status(400).json({
      error: "One or more line IDs do not belong to this invoice.", code: "invoice.lines_mismatch",
    });
    return;
  }
  const previousCategories = matched.map((m) => ({
    lineId: m.id,
    incomeCategory: m.incomeCategory,
    isManualOverride: m.isManualOverride,
  }));

  // incomeCategory has no impact on amount/tax so we deliberately do NOT
  // recompute invoice totals — saves the extra read/write on big batches.
  // Group the plan by (category, manualOverride) so we issue one UPDATE per
  // bucket instead of N. In the common single-category path this collapses
  // to exactly one statement; the undo path issues at most a handful.
  type Bucket = { category: InvoiceLineIncomeCategory; manual: boolean; ids: number[] };
  const buckets = new Map<string, Bucket>();
  for (const p of plan) {
    const key = `${p.category}|${p.setManualOverride ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { category: p.category, manual: p.setManualOverride, ids: [] };
      buckets.set(key, b);
    }
    b.ids.push(p.lineId);
  }
  // Audit metadata: a `lineIds` body shape is the bulk-set affordance,
  // anything else (the per-line `updates` shape) is the in-invoice Undo
  // counterpart. Capturing this lets the dashboard distinguish "admin
  // changed 5 lines" from "admin undid that change 12 minutes later"
  // without having to reconstruct intent from category diffs.
  const auditAction: "bulk_set" | "undo" =
    "lineIds" in body.data ? "bulk_set" : "undo";
  const batchId = randomUUID();
  const priorById = new Map(previousCategories.map((p) => [p.lineId, p]));

  await db.transaction(async (tx) => {
    for (const b of buckets.values()) {
      await tx
        .update(invoiceLinesTable)
        .set({
          incomeCategory: b.category,
          isManualOverride: b.manual,
        })
        .where(
          and(
            eq(invoiceLinesTable.invoiceId, invoice.id),
            inArray(invoiceLinesTable.id, b.ids),
          ),
        );
    }
    // Audit rows are inserted inside the same transaction so a row
    // either has its audit entry or neither write happens — the
    // accountant's history can't drift from the data.
    const auditRows = plan
      .map((p) => {
        const prior = priorById.get(p.lineId);
        if (!prior) return null;
        // Skip no-ops (same category, same manual-override flag) so the
        // audit feed stays signal-heavy.
        if (
          prior.incomeCategory === p.category &&
          prior.isManualOverride === p.setManualOverride
        ) {
          return null;
        }
        return {
          batchId,
          action: auditAction,
          invoiceId: invoice.id,
          lineId: p.lineId,
          vendorId: invoice.vendorId,
          partnerId: invoice.partnerId,
          priorIncomeCategory: prior.incomeCategory,
          priorIsManualOverride: prior.isManualOverride,
          newIncomeCategory: p.category,
          newIsManualOverride: p.setManualOverride,
          actorUserId: session.userId ?? null,
          actorRole: session.role ?? "unknown",
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (auditRows.length > 0) {
      await tx.insert(invoiceLineCategoryAuditTable).values(auditRows);
    }
  });
  res.json({
    ok: true,
    updated: uniqueIds.length,
    lineIds: uniqueIds,
    previousCategories,
    auditBatchId: batchId,
  });
});

// ──────────────────────────────────────────────────────────────────
// POST /invoices/bulk-recategorize-1099 — admin vendor-level cleanup
//
// Year-end shortcut for the 1099 dashboard: set every DRAFT invoice line
// for a given vendor (optionally bounded to a tax year by period_start)
// to a single income category in one shot. Sent/paid/cancelled invoices
// are immutable and never touched. Admin-only because it affects every
// partner that has a draft invoice with this vendor.
// ──────────────────────────────────────────────────────────────────

const BulkRecategorize1099Body = z.object({
  vendorId: z.coerce.number().int().positive(),
  incomeCategory: z.enum(INVOICE_LINE_INCOME_CATEGORIES),
  // Optional UTC tax-year filter applied against invoice.period_start
  // (the same field the 1099 reports use to attribute the line to a year).
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

router.post(
  "/invoices/bulk-recategorize-1099",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }
    const body = BulkRecategorize1099Body.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    const conds = [
      eq(invoicesTable.vendorId, body.data.vendorId),
      eq(invoicesTable.status, "draft"),
    ];
    if (body.data.year !== undefined) {
      // [Jan 1 UTC, Jan 1 UTC of next year) — same half-open range the
      // year-end 1099 rollups use, so the dashboard "what's reportable
      // for 2026" view and this admin action agree on which lines are
      // in scope.
      const start = new Date(Date.UTC(body.data.year, 0, 1));
      const end = new Date(Date.UTC(body.data.year + 1, 0, 1));
      conds.push(gte(invoicesTable.periodStart, start));
      conds.push(lt(invoicesTable.periodStart, end));
    }
    const draftInvoices = await db
      .select({
        id: invoicesTable.id,
        vendorId: invoicesTable.vendorId,
        partnerId: invoicesTable.partnerId,
      })
      .from(invoicesTable)
      .where(and(...conds));
    if (draftInvoices.length === 0) {
      res.json({
        ok: true,
        invoicesScanned: 0,
        linesUpdated: 0,
        previousCategories: [],
      });
      return;
    }
    const invoiceIds = draftInvoices.map((r) => r.id);
    const invoiceMetaById = new Map(
      draftInvoices.map((r) => [
        r.id,
        { vendorId: r.vendorId, partnerId: r.partnerId },
      ]),
    );
    const batchId = randomUUID();
    // Wrap snapshot + update + audit-row insert in one transaction so
    // the audit history can never disagree with the data: either the
    // rows flipped AND were logged, or neither happened. We re-snapshot
    // inside the tx for the same reason — a concurrent edit between an
    // outside-tx snapshot and the in-tx update would otherwise produce
    // an incorrect audit "prior" value.
    let snapshot: Array<{
      lineId: number;
      incomeCategory: string;
      isManualOverride: boolean;
      invoiceId: number;
    }> = [];
    let updatedCount = 0;
    await db.transaction(async (tx) => {
      const before = await tx
        .select({
          id: invoiceLinesTable.id,
          invoiceId: invoiceLinesTable.invoiceId,
          incomeCategory: invoiceLinesTable.incomeCategory,
          isManualOverride: invoiceLinesTable.isManualOverride,
        })
        .from(invoiceLinesTable)
        .where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
      snapshot = before.map((b) => ({
        lineId: b.id,
        invoiceId: b.invoiceId,
        incomeCategory: b.incomeCategory,
        isManualOverride: b.isManualOverride,
      }));
      const updated = await tx
        .update(invoiceLinesTable)
        .set({
          incomeCategory: body.data.incomeCategory,
          isManualOverride: true,
        })
        .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
        .returning({ id: invoiceLinesTable.id });
      updatedCount = updated.length;
      const updatedIds = new Set(updated.map((r) => r.id));
      const auditRows = snapshot
        .filter((s) => updatedIds.has(s.lineId))
        .filter(
          // Drop no-ops where neither category nor override flag actually
          // changed — keeps the audit feed signal-heavy.
          (s) =>
            s.incomeCategory !== body.data.incomeCategory ||
            s.isManualOverride !== true,
        )
        .map((s) => {
          const meta = invoiceMetaById.get(s.invoiceId);
          return {
            batchId,
            action: "vendor_recategorize" as const,
            invoiceId: s.invoiceId,
            lineId: s.lineId,
            vendorId: meta?.vendorId ?? body.data.vendorId,
            partnerId: meta?.partnerId ?? null,
            priorIncomeCategory: s.incomeCategory,
            priorIsManualOverride: s.isManualOverride,
            newIncomeCategory: body.data.incomeCategory,
            newIsManualOverride: true,
            actorUserId: session.userId ?? null,
            actorRole: session.role ?? "unknown",
          };
        });
      if (auditRows.length > 0) {
        await tx.insert(invoiceLineCategoryAuditTable).values(auditRows);
      }
    });
    res.json({
      ok: true,
      invoicesScanned: invoiceIds.length,
      linesUpdated: updatedCount,
      previousCategories: snapshot.map((b) => ({
        lineId: b.lineId,
        incomeCategory: b.incomeCategory,
        isManualOverride: b.isManualOverride,
      })),
      auditBatchId: batchId,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// POST /invoices/restore-1099-categories — admin Undo for vendor-level
// recategorize.
//
// The vendor-level cleanup endpoint above touches lines across many
// invoices in one shot, so an Undo can't go through the per-invoice
// PATCH /invoices/:id/lines (it only knows about one invoice at a time).
// This sibling endpoint accepts the snapshot the cleanup call returned
// and writes each line's prior (incomeCategory, isManualOverride) back.
//
// Safety:
//   - Admin only — same audience as the bulk recategorize that produced
//     the snapshot.
//   - Restores only DRAFT lines. If a line's invoice was sent or paid
//     between the original action and the Undo, that line is skipped
//     (sent/paid invoices stay immutable). The response reports how
//     many lines were skipped so the UI can surface a "partial undo"
//     state if needed.
// ──────────────────────────────────────────────────────────────────

const Restore1099Body = z.object({
  updates: z
    .array(
      z.object({
        lineId: z.coerce.number().int().positive(),
        incomeCategory: z.enum(INVOICE_LINE_INCOME_CATEGORIES),
        isManualOverride: z.boolean(),
      }),
    )
    .min(1)
    .max(5000),
});

router.post(
  "/invoices/restore-1099-categories",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }
    const body = Restore1099Body.safeParse(req.body);
    if (!body.success) {
      sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
      return;
    }
    // Dedupe by lineId, last write wins.
    const byId = new Map<
      number,
      {
        lineId: number;
        incomeCategory: InvoiceLineIncomeCategory;
        isManualOverride: boolean;
      }
    >();
    for (const u of body.data.updates) {
      byId.set(u.lineId, u);
    }
    const updates = Array.from(byId.values());
    const ids = updates.map((u) => u.lineId);

    // Pull the line→invoice mapping, current state, and invoice statuses
    // in one go. We need the current (category, override-flag) so the
    // audit row's "prior" reflects what we actually overwrote, plus
    // vendor/partner so the dashboard can filter the audit feed. We also
    // fetch the human-readable invoice number so the UI can list exactly
    // which lines were skipped (and on which invoice) without a
    // follow-up round-trip.
    const rows = await db
      .select({
        lineId: invoiceLinesTable.id,
        invoiceId: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceStatus: invoicesTable.status,
        vendorId: invoicesTable.vendorId,
        partnerId: invoicesTable.partnerId,
        currentIncomeCategory: invoiceLinesTable.incomeCategory,
        currentIsManualOverride: invoiceLinesTable.isManualOverride,
      })
      .from(invoiceLinesTable)
      .innerJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLinesTable.invoiceId),
      )
      .where(inArray(invoiceLinesTable.id, ids));
    const lineMetaById = new Map(rows.map((r) => [r.lineId, r]));
    type SkippedEntry = {
      lineId: number;
      invoiceId: number | null;
      invoiceNumber: string | null;
      reason: "not_draft" | "not_found";
    };
    const skipped: SkippedEntry[] = [];
    const eligible: typeof updates = [];
    for (const u of updates) {
      const row = lineMetaById.get(u.lineId);
      if (!row) {
        skipped.push({
          lineId: u.lineId,
          invoiceId: null,
          invoiceNumber: null,
          reason: "not_found",
        });
        continue;
      }
      if (row.invoiceStatus !== "draft") {
        skipped.push({
          lineId: u.lineId,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          reason: "not_draft",
        });
        continue;
      }
      eligible.push(u);
    }
    if (eligible.length === 0) {
      res.json({ ok: true, restored: 0, skipped });
      return;
    }
    const batchId = randomUUID();

    // Group by (category, manualOverride) so we run at most a handful of
    // statements even when restoring thousands of mixed lines.
    type Bucket = {
      category: InvoiceLineIncomeCategory;
      manual: boolean;
      ids: number[];
    };
    const buckets = new Map<string, Bucket>();
    for (const u of eligible) {
      const key = `${u.incomeCategory}|${u.isManualOverride ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          category: u.incomeCategory,
          manual: u.isManualOverride,
          ids: [],
        };
        buckets.set(key, b);
      }
      b.ids.push(u.lineId);
    }
    await db.transaction(async (tx) => {
      for (const b of buckets.values()) {
        await tx
          .update(invoiceLinesTable)
          .set({
            incomeCategory: b.category,
            isManualOverride: b.manual,
          })
          .where(inArray(invoiceLinesTable.id, b.ids));
      }
      // Audit: each restored line gets a row reflecting what it was
      // immediately before the restore (the post-bulk state) and the
      // values the caller asked us to put back. Skipped (non-draft)
      // lines are intentionally not audited — we did not touch them.
      const auditRows = eligible
        .map((u) => {
          const meta = lineMetaById.get(u.lineId);
          if (!meta) return null;
          if (
            meta.currentIncomeCategory === u.incomeCategory &&
            meta.currentIsManualOverride === u.isManualOverride
          ) {
            return null;
          }
          return {
            batchId,
            action: "undo" as const,
            invoiceId: meta.invoiceId,
            lineId: u.lineId,
            vendorId: meta.vendorId,
            partnerId: meta.partnerId,
            priorIncomeCategory: meta.currentIncomeCategory,
            priorIsManualOverride: meta.currentIsManualOverride,
            newIncomeCategory: u.incomeCategory,
            newIsManualOverride: u.isManualOverride,
            actorUserId: session.userId ?? null,
            actorRole: session.role ?? "unknown",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (auditRows.length > 0) {
        await tx.insert(invoiceLineCategoryAuditTable).values(auditRows);
      }
    });
    res.json({
      ok: true,
      restored: eligible.length,
      skipped,
      auditBatchId: batchId,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /invoices/audit/1099-categories — recent bulk-category changes
//
// Backs the "Show recent category changes" view on the Reports 1099
// dashboard. Returns one row per audited line write (bulk_set / undo /
// vendor_recategorize), newest first, with actor display info batched in.
//
// Filters:
//   vendorId — required for vendor scope; admins may pass it to narrow.
//   partnerId — partner scope (mirror of vendorId).
//   year — bounds by createdAt (Jan 1 UTC … Jan 1 UTC of the next year);
//          matches the half-open range the dashboard already uses for
//          the year selector.
//
// Auth:
//   admin       — sees everything; vendorId / partnerId optional.
//   vendor      — sees only their own vendor's audit feed; vendorId is
//                 forced to session.vendorId so a vendor can't peek at
//                 another vendor's changes.
//   partner     — same shape, forced to session.partnerId.
// ──────────────────────────────────────────────────────────────────
const CategoryAuditQuery = z.object({
  vendorId: z.coerce.number().int().positive().optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get(
  "/invoices/audit/1099-categories",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res
        .status(401)
        .json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    const query = CategoryAuditQuery.safeParse(req.query);
    if (!query.success) {
      sendValidationFailed(res, query.error, {
        code: "validation.invalid_input",
      });
      return;
    }

    const filters = [];
    // RBAC: non-admin callers are scoped to their own vendor/partner so
    // a vendor can't iterate the audit feed for somebody else's books.
    if (session.role === "vendor") {
      if (session.vendorId == null) {
        res
          .status(403)
          .json({ error: "Vendor scope required", code: "auth.scope_required" });
        return;
      }
      filters.push(
        eq(invoiceLineCategoryAuditTable.vendorId, session.vendorId),
      );
    } else if (session.role === "partner") {
      if (session.partnerId == null) {
        res.status(403).json({
          error: "Partner scope required",
          code: "auth.scope_required",
        });
        return;
      }
      filters.push(
        eq(invoiceLineCategoryAuditTable.partnerId, session.partnerId),
      );
    } else if (session.role !== "admin") {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    if (query.data.vendorId !== undefined) {
      // For vendor sessions this is redundant with the forced filter
      // above; for admin sessions it narrows to the requested vendor.
      filters.push(
        eq(invoiceLineCategoryAuditTable.vendorId, query.data.vendorId),
      );
    }
    if (query.data.partnerId !== undefined) {
      filters.push(
        eq(invoiceLineCategoryAuditTable.partnerId, query.data.partnerId),
      );
    }
    if (query.data.year !== undefined) {
      const start = new Date(Date.UTC(query.data.year, 0, 1));
      const end = new Date(Date.UTC(query.data.year + 1, 0, 1));
      filters.push(gte(invoiceLineCategoryAuditTable.createdAt, start));
      filters.push(lt(invoiceLineCategoryAuditTable.createdAt, end));
    }

    const limit = query.data.limit ?? 100;
    const offset = query.data.offset ?? 0;
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const baseSelect = db
      .select({
        id: invoiceLineCategoryAuditTable.id,
        batchId: invoiceLineCategoryAuditTable.batchId,
        action: invoiceLineCategoryAuditTable.action,
        invoiceId: invoiceLineCategoryAuditTable.invoiceId,
        lineId: invoiceLineCategoryAuditTable.lineId,
        vendorId: invoiceLineCategoryAuditTable.vendorId,
        partnerId: invoiceLineCategoryAuditTable.partnerId,
        priorIncomeCategory:
          invoiceLineCategoryAuditTable.priorIncomeCategory,
        priorIsManualOverride:
          invoiceLineCategoryAuditTable.priorIsManualOverride,
        newIncomeCategory: invoiceLineCategoryAuditTable.newIncomeCategory,
        newIsManualOverride:
          invoiceLineCategoryAuditTable.newIsManualOverride,
        actorUserId: invoiceLineCategoryAuditTable.actorUserId,
        actorRole: invoiceLineCategoryAuditTable.actorRole,
        createdAt: invoiceLineCategoryAuditTable.createdAt,
        invoiceNumber: invoicesTable.invoiceNumber,
      })
      .from(invoiceLineCategoryAuditTable)
      .leftJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLineCategoryAuditTable.invoiceId),
      );
    const auditRows = await (whereClause
      ? baseSelect.where(whereClause)
      : baseSelect)
      .orderBy(desc(invoiceLineCategoryAuditTable.id))
      .limit(limit)
      .offset(offset);

    const actorIds = Array.from(
      new Set(
        auditRows
          .map((r) => r.actorUserId)
          .filter((v): v is number => v != null),
      ),
    );
    const vendorIds = Array.from(
      new Set(
        auditRows
          .map((r) => r.vendorId)
          .filter((v): v is number => v != null),
      ),
    );
    const partnerIds = Array.from(
      new Set(
        auditRows
          .map((r) => r.partnerId)
          .filter((v): v is number => v != null),
      ),
    );
    const [actorRows, vendorRows, partnerRows] = await Promise.all([
      actorIds.length
        ? db
            .select({
              id: usersTable.id,
              displayName: usersTable.displayName,
              username: usersTable.username,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, actorIds))
        : Promise.resolve(
            [] as { id: number; displayName: string | null; username: string }[],
          ),
      vendorIds.length
        ? db
            .select({ id: vendorsTable.id, name: vendorsTable.name })
            .from(vendorsTable)
            .where(inArray(vendorsTable.id, vendorIds))
        : Promise.resolve([] as { id: number; name: string }[]),
      partnerIds.length
        ? db
            .select({ id: partnersTable.id, name: partnersTable.name })
            .from(partnersTable)
            .where(inArray(partnersTable.id, partnerIds))
        : Promise.resolve([] as { id: number; name: string }[]),
    ]);
    const actorById = new Map(actorRows.map((u) => [u.id, u]));
    const vendorNameById = new Map(vendorRows.map((v) => [v.id, v.name]));
    const partnerNameById = new Map(partnerRows.map((p) => [p.id, p.name]));

    res.json({
      rows: auditRows.map((r) => {
        const actor =
          r.actorUserId != null ? actorById.get(r.actorUserId) : null;
        return {
          id: r.id,
          batchId: r.batchId,
          action: r.action,
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber ?? null,
          lineId: r.lineId,
          vendorId: r.vendorId,
          vendorName:
            r.vendorId != null ? vendorNameById.get(r.vendorId) ?? null : null,
          partnerId: r.partnerId,
          partnerName:
            r.partnerId != null
              ? partnerNameById.get(r.partnerId) ?? null
              : null,
          priorIncomeCategory: r.priorIncomeCategory,
          priorIsManualOverride: r.priorIsManualOverride,
          newIncomeCategory: r.newIncomeCategory,
          newIsManualOverride: r.newIsManualOverride,
          actorUserId: r.actorUserId,
          actorRole: r.actorRole,
          actorDisplayName: actor?.displayName ?? null,
          actorUsername: actor?.username ?? null,
          createdAt: r.createdAt,
        };
      }),
      limit,
      offset,
    });
  },
);


// ──────────────────────────────────────────────────────────────────
// POST /invoices/backfill-1099-categories — admin one-shot backfill
//
// Re-derive `income_category` on every existing DRAFT invoice line that the
// engine still owns (is_manual_override = false) using the same lineType-aware
// mapping the generator now uses, honoring per-(vendor, partner) overrides
// from vendor_partner_billing_settings. Lines whose current category already
// matches the resolved value are skipped so the run produces no churn.
//
// Why this exists: the lineType-aware auto-suggest only takes effect on
// *newly* generated lines. Anything created before that landed defaulted
// to 'nec' across the board, so equipment / mileage / per_diem / etc. on
// existing draft invoices would otherwise get misclassified at year end.
//
// Sent / paid / cancelled invoices are intentionally NOT touched — once
// an invoice has left draft its lines are immutable for reporting
// purposes (1099 totals, accounting export integrity, etc.). Supplemental
// invoices are also excluded even when their status is still 'draft':
// they're a delta against an already-sent root invoice and their lines
// are treated as immutable alongside the root they amend.
// Manual per-line overrides (is_manual_override = true) are also skipped
// for the same reason — those are deliberate user choices.
//
// The updates leave is_manual_override = false so a future regenerate can
// still refresh the line. Per-line-type → target-category counts are
// returned in the response and emitted to the audit log.
// ──────────────────────────────────────────────────────────────────

router.post(
  "/invoices/backfill-1099-categories",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }

    // Each invocation gets a fresh runId stamped on every audit row it
    // writes, so the admin "list runs" / "show this run's lines"
    // endpoints below can scope their queries to one invocation. We
    // generate it up front and return it in the response so the UI can
    // immediately deep-link to the per-run detail view.
    const runId = randomUUID();
    const actorUserId = session.userId ?? null;
    const actorRole = session.role;

    // Pull every candidate line in one query, joined to its invoice so we
    // know the (vendor, partner) tuple needed to resolve overrides.
    // `invoiceId` is also selected so the per-line audit row can record
    // which invoice the touched line belongs to without a re-lookup.
    const candidates = await db
      .select({
        id: invoiceLinesTable.id,
        invoiceId: invoiceLinesTable.invoiceId,
        lineType: invoiceLinesTable.lineType,
        currentCategory: invoiceLinesTable.incomeCategory,
        vendorId: invoicesTable.vendorId,
        partnerId: invoicesTable.partnerId,
      })
      .from(invoiceLinesTable)
      .innerJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLinesTable.invoiceId),
      )
      .where(
        and(
          eq(invoicesTable.status, "draft"),
          eq(invoiceLinesTable.isManualOverride, false),
          // Supplemental invoices are excluded by design: even when a
          // supplemental is still in 'draft' it represents a delta against
          // an already-sent root invoice, and its lines are treated as
          // immutable for 1099 reporting alongside the root they amend.
          isNull(invoicesTable.supplementalOfInvoiceId),
        ),
      );

    // Single bulk fetch of every override map. The set of (vendor, partner)
    // billing settings rows is small relative to invoice_lines, so an
    // unfiltered SELECT here is cheaper than emitting one lookup per line.
    const settingsRows = await db
      .select({
        vendorId: vendorPartnerBillingSettingsTable.vendorId,
        partnerId: vendorPartnerBillingSettingsTable.partnerId,
        overrides:
          vendorPartnerBillingSettingsTable.defaultIncomeCategoryOverrides,
      })
      .from(vendorPartnerBillingSettingsTable);

    const overrideByPair = new Map<string, IncomeCategoryOverrideMap | null>();
    for (const row of settingsRows) {
      overrideByPair.set(`${row.vendorId}|${row.partnerId}`, row.overrides);
    }

    // Group line ids per resolved target category so we can issue a single
    // UPDATE per category instead of one per line. Per-line-type counters
    // double-key on the resolved category to make the audit log informative
    // ("we moved 432 'equipment' lines to 'misc_rents'"). The
    // `candidateById` map lets us cheaply look up the (invoiceId,
    // vendorId, partnerId, oldCategory, lineType) tuple when writing per-
    // line audit rows for whatever the UPDATE actually mutated.
    const idsByTarget = new Map<InvoiceLineIncomeCategory, number[]>();
    const candidateById = new Map<
      number,
      {
        invoiceId: number;
        vendorId: number;
        partnerId: number;
        oldCategory: InvoiceLineIncomeCategory;
        lineType: InvoiceLineType;
      }
    >();
    const countsByLineType: Record<
      string,
      Partial<Record<InvoiceLineIncomeCategory, number>>
    > = {};
    let scanned = 0;
    let skippedAlreadyCorrect = 0;
    let skippedUnknownLineType = 0;

    const validLineTypes = new Set<string>(INVOICE_LINE_TYPES);

    for (const line of candidates) {
      scanned += 1;
      // Defensive: if a row carries an unknown line_type (e.g. legacy data
      // before the enum tightened), don't try to recategorize it.
      if (!validLineTypes.has(line.lineType)) {
        skippedUnknownLineType += 1;
        continue;
      }
      const lt = line.lineType as InvoiceLineType;
      const overrides =
        overrideByPair.get(`${line.vendorId}|${line.partnerId}`) ?? null;
      const target = resolveIncomeCategory(lt, overrides);
      if (target === line.currentCategory) {
        skippedAlreadyCorrect += 1;
        continue;
      }
      let bucket = idsByTarget.get(target);
      if (!bucket) {
        bucket = [];
        idsByTarget.set(target, bucket);
      }
      bucket.push(line.id);
      candidateById.set(line.id, {
        invoiceId: line.invoiceId,
        vendorId: line.vendorId,
        partnerId: line.partnerId,
        oldCategory: line.currentCategory as InvoiceLineIncomeCategory,
        lineType: lt,
      });
      const ltCounts =
        countsByLineType[lt] ?? (countsByLineType[lt] = {});
      ltCounts[target] = (ltCounts[target] ?? 0) + 1;
    }

    // Chunk to keep parameter counts under Postgres' 65k limit on big runs.
    // The UPDATE re-asserts the eligibility predicates (draft status,
    // non-supplemental, non-manual-override) inside the WHERE clause itself.
    // The candidate snapshot above could be stale by the time we issue the
    // UPDATE — e.g. an invoice could have been sent or a line marked as a
    // manual override mid-run — and the task forbids us from silently
    // rewriting anything that's left draft. Re-checking inside the UPDATE
    // closes that race window without needing a SERIALIZABLE transaction.
    const CHUNK = 5000;
    let totalUpdated = 0;
    for (const [category, ids] of idsByTarget.entries()) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        // Wrap the UPDATE and its corresponding audit-row INSERT in a
        // single transaction so we can never have a category flip
        // without its audit row, and never an audit row without the
        // matching flip. The audit insert references the rows the
        // UPDATE actually mutated (via .returning()), so any candidate
        // the WHERE re-check rejected (sent/manual-override/supplemental
        // race) is correctly excluded from the audit log too.
        await db.transaction(async (tx) => {
          const result = await tx
            .update(invoiceLinesTable)
            .set({ incomeCategory: category })
            .where(
              and(
                inArray(invoiceLinesTable.id, slice),
                eq(invoiceLinesTable.isManualOverride, false),
                sql`exists (
                  select 1 from ${invoicesTable}
                  where ${invoicesTable.id} = ${invoiceLinesTable.invoiceId}
                    and ${invoicesTable.status} = 'draft'
                    and ${invoicesTable.supplementalOfInvoiceId} is null
                )`,
              ),
            )
            .returning({ id: invoiceLinesTable.id });
          totalUpdated += result.length;
          if (result.length > 0) {
            await tx
              .insert(invoiceLineCategoryBackfillAuditLogTable)
              .values(
                result.map((r) => {
                  // candidateById is guaranteed populated for every id
                  // we passed into this batch — the slice was built
                  // from idsByTarget, which was populated alongside
                  // candidateById in the same loop above.
                  const meta = candidateById.get(r.id)!;
                  return {
                    runId,
                    lineId: r.id,
                    invoiceId: meta.invoiceId,
                    vendorId: meta.vendorId,
                    partnerId: meta.partnerId,
                    lineType: meta.lineType,
                    oldIncomeCategory: meta.oldCategory,
                    newIncomeCategory: category,
                    actorUserId,
                    actorRole,
                  };
                }),
              );
          }
        });
      }
    }

    logger.info(
      {
        action: "backfill_1099_categories",
        runId,
        scanned,
        updated: totalUpdated,
        skippedAlreadyCorrect,
        skippedUnknownLineType,
        countsByLineType,
        userId: session.userId,
      },
      "Backfilled 1099 income_category on existing draft invoice lines",
    );

    res.json({
      ok: true,
      runId,
      scanned,
      updated: totalUpdated,
      skippedAlreadyCorrect,
      skippedUnknownLineType,
      countsByLineType,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /invoices/backfill-1099-categories/runs — admin-only list of every
// past backfill invocation that actually mutated at least one line.
//
// Each row aggregates the per-line audit table by runId so admins can
// answer "who ran the backfill, when, and how many lines did it move?"
// at a glance. The detail view below (`/runs/:runId`) returns the
// per-line breakdown for a single run.
//
// Returned newest-first and capped at 100 — the same ceiling the QB
// account-mapping cleanup-audit list uses. Backfill runs are rare
// (year-end cleanup) so 100 covers many years of history.
// ──────────────────────────────────────────────────────────────────
router.get(
  "/invoices/backfill-1099-categories/runs",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res
        .status(401)
        .json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }

    const limitRaw = Number(req.query.limit ?? 20);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.max(Math.floor(limitRaw), 1), 100)
        : 20;

    // Group-by runId returns one summary row per invocation. We pull
    // the actor from the MIN(audit.id) row in the group (every row in
    // a single run shares the same actor) via a correlated subquery
    // pattern using MIN over actorUserId / actorRole — both are
    // constant within a run, so MIN is just "any value from the group".
    // startedAt = MIN(createdAt) is the wall-clock start of the run.
    const rows = await db
      .select({
        runId: invoiceLineCategoryBackfillAuditLogTable.runId,
        startedAt: sql<Date>`min(${invoiceLineCategoryBackfillAuditLogTable.createdAt})`,
        finishedAt: sql<Date>`max(${invoiceLineCategoryBackfillAuditLogTable.createdAt})`,
        linesChanged: sql<number>`count(*)::int`,
        invoicesTouched: sql<number>`count(distinct ${invoiceLineCategoryBackfillAuditLogTable.invoiceId})::int`,
        actorUserId: sql<
          number | null
        >`min(${invoiceLineCategoryBackfillAuditLogTable.actorUserId})`,
        actorRole: sql<string>`min(${invoiceLineCategoryBackfillAuditLogTable.actorRole})`,
      })
      .from(invoiceLineCategoryBackfillAuditLogTable)
      .groupBy(invoiceLineCategoryBackfillAuditLogTable.runId)
      .orderBy(
        desc(sql`min(${invoiceLineCategoryBackfillAuditLogTable.createdAt})`),
      )
      .limit(limit);

    // Resolve actor display names in a single batched lookup. Rows
    // whose actor user has been deleted (FK is set null) get a null
    // displayName / username — the UI can show "(deleted user)".
    const actorIds = Array.from(
      new Set(
        rows.map((r) => r.actorUserId).filter((v): v is number => v != null),
      ),
    );
    const actorRows = actorIds.length
      ? await db
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            username: usersTable.username,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds))
      : [];
    const actorById = new Map(actorRows.map((u) => [u.id, u]));

    res.json({
      rows: rows.map((r) => {
        const actor = r.actorUserId != null ? actorById.get(r.actorUserId) : null;
        return {
          runId: r.runId,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          linesChanged: r.linesChanged,
          invoicesTouched: r.invoicesTouched,
          actorUserId: r.actorUserId,
          actorRole: r.actorRole,
          actorDisplayName: actor?.displayName ?? null,
          actorUsername: actor?.username ?? null,
        };
      }),
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /invoices/backfill-1099-categories/runs/:runId — admin-only
// per-line breakdown of a single backfill invocation. Each row records
// (lineId, invoiceId, vendor, partner, lineType, old → new
// incomeCategory). Vendor and partner names are batched-resolved for
// the slice so the UI can render human-readable labels.
//
// Optional `?vendorId=` / `?partnerId=` / `?lineType=` filters narrow
// the list — useful for the motivating audit question "which draft
// invoices for vendor X had their equipment lines flipped to
// misc_rents?". Pagination is offset/limit (limit capped at 1000) so
// even a 50k-line run is browsable.
// ──────────────────────────────────────────────────────────────────
const BackfillRunDetailParams = z.object({
  runId: z.string().uuid(),
});
const BackfillRunDetailQuery = z.object({
  vendorId: z.coerce.number().int().positive().optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  lineType: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get(
  "/invoices/backfill-1099-categories/runs/:runId",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res
        .status(401)
        .json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }
    const params = BackfillRunDetailParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error, {
        code: "validation.invalid_input",
      });
      return;
    }
    const query = BackfillRunDetailQuery.safeParse(req.query);
    if (!query.success) {
      sendValidationFailed(res, query.error, {
        code: "validation.invalid_input",
      });
      return;
    }

    const filters = [
      eq(invoiceLineCategoryBackfillAuditLogTable.runId, params.data.runId),
    ];
    if (query.data.vendorId !== undefined) {
      filters.push(
        eq(
          invoiceLineCategoryBackfillAuditLogTable.vendorId,
          query.data.vendorId,
        ),
      );
    }
    if (query.data.partnerId !== undefined) {
      filters.push(
        eq(
          invoiceLineCategoryBackfillAuditLogTable.partnerId,
          query.data.partnerId,
        ),
      );
    }
    if (query.data.lineType !== undefined) {
      filters.push(
        eq(
          invoiceLineCategoryBackfillAuditLogTable.lineType,
          query.data.lineType,
        ),
      );
    }
    const limit = query.data.limit ?? 200;
    const offset = query.data.offset ?? 0;

    const whereClause = and(...filters);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(invoiceLineCategoryBackfillAuditLogTable)
      .where(whereClause);

    const auditRows = await db
      .select({
        id: invoiceLineCategoryBackfillAuditLogTable.id,
        lineId: invoiceLineCategoryBackfillAuditLogTable.lineId,
        invoiceId: invoiceLineCategoryBackfillAuditLogTable.invoiceId,
        vendorId: invoiceLineCategoryBackfillAuditLogTable.vendorId,
        partnerId: invoiceLineCategoryBackfillAuditLogTable.partnerId,
        lineType: invoiceLineCategoryBackfillAuditLogTable.lineType,
        oldIncomeCategory:
          invoiceLineCategoryBackfillAuditLogTable.oldIncomeCategory,
        newIncomeCategory:
          invoiceLineCategoryBackfillAuditLogTable.newIncomeCategory,
        actorUserId: invoiceLineCategoryBackfillAuditLogTable.actorUserId,
        actorRole: invoiceLineCategoryBackfillAuditLogTable.actorRole,
        createdAt: invoiceLineCategoryBackfillAuditLogTable.createdAt,
        invoiceNumber: invoicesTable.invoiceNumber,
      })
      .from(invoiceLineCategoryBackfillAuditLogTable)
      .leftJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLineCategoryBackfillAuditLogTable.invoiceId),
      )
      .where(whereClause)
      .orderBy(invoiceLineCategoryBackfillAuditLogTable.id)
      .limit(limit)
      .offset(offset);

    // Batch-resolve vendor / partner display names for the page.
    const vendorIds = Array.from(
      new Set(
        auditRows.map((r) => r.vendorId).filter((v): v is number => v != null),
      ),
    );
    const partnerIds = Array.from(
      new Set(
        auditRows
          .map((r) => r.partnerId)
          .filter((v): v is number => v != null),
      ),
    );
    const [vendorRows, partnerRows] = await Promise.all([
      vendorIds.length
        ? db
            .select({ id: vendorsTable.id, name: vendorsTable.name })
            .from(vendorsTable)
            .where(inArray(vendorsTable.id, vendorIds))
        : Promise.resolve([] as { id: number; name: string }[]),
      partnerIds.length
        ? db
            .select({ id: partnersTable.id, name: partnersTable.name })
            .from(partnersTable)
            .where(inArray(partnersTable.id, partnerIds))
        : Promise.resolve([] as { id: number; name: string }[]),
    ]);
    const vendorNameById = new Map(vendorRows.map((v) => [v.id, v.name]));
    const partnerNameById = new Map(partnerRows.map((p) => [p.id, p.name]));

    res.json({
      runId: params.data.runId,
      total,
      limit,
      offset,
      rows: auditRows.map((r) => ({
        id: r.id,
        lineId: r.lineId,
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber ?? null,
        vendorId: r.vendorId,
        vendorName: r.vendorId != null ? vendorNameById.get(r.vendorId) ?? null : null,
        partnerId: r.partnerId,
        partnerName:
          r.partnerId != null ? partnerNameById.get(r.partnerId) ?? null : null,
        lineType: r.lineType,
        oldIncomeCategory: r.oldIncomeCategory,
        newIncomeCategory: r.newIncomeCategory,
        actorUserId: r.actorUserId,
        actorRole: r.actorRole,
        createdAt: r.createdAt,
      })),
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// PATCH /invoices/:id/lines/:lineId — manual edit (marks override)
// ──────────────────────────────────────────────────────────────────

const LineIdParams = z.object({
  id: z.coerce.number().int(),
  lineId: z.coerce.number().int(),
});

const PatchLineBody = z
  .object({
    description: z.string().min(1).optional(),
    quantity: z.string().regex(/^-?\d+(\.\d{1,4})?$/).optional(),
    unitPrice: z.string().regex(/^-?\d+(\.\d{1,4})?$/).optional(),
    taxable: z.boolean().optional(),
    // 1099 income category — drives 1099-MISC box routing and 1099-K
    // attribution at year end. Default 'nec' matches the schema default.
    incomeCategory: z.enum(INVOICE_LINE_INCOME_CATEGORIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });

router.patch("/invoices/:id/lines/:lineId", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const params = LineIdParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const body = PatchLineBody.safeParse(req.body);
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canEditInvoice(session, invoice)) {
    res.status(403).json({ error: "Cannot edit this invoice", code: "invoice.cannot_edit" });
    return;
  }
  const [line] = await db
    .select()
    .from(invoiceLinesTable)
    .where(
      and(
        eq(invoiceLinesTable.id, params.data.lineId),
        eq(invoiceLinesTable.invoiceId, invoice.id),
      ),
    );
  if (!line) {
    res.status(404).json({ error: "Line not found", code: "invoice.line_not_found" });
    return;
  }

  const newQty = body.data.quantity ?? line.quantity;
  const newPrice = body.data.unitPrice ?? line.unitPrice;
  // Use the engine's bigint fixed-precision math so manual edits round
  // identically to generator output (no cent-level drift from Number arithmetic).
  const qtyUnits = toFixedUnits(newQty);
  const priceUnits = toFixedUnits(newPrice);
  const amountUnits = mulUnits(qtyUnits, priceUnits);
  const amount = unitsToString2(amountUnits);
  const newTaxable = body.data.taxable ?? line.taxable;
  const taxRateUnits = toFixedUnits(line.taxRate ?? "0");
  const taxAmount = newTaxable
    ? unitsToString2(mulUnits(amountUnits, taxRateUnits))
    : "0.00";

  await db.transaction(async (tx) => {
    await tx
      .update(invoiceLinesTable)
      .set({
        description: body.data.description ?? line.description,
        quantity: newQty,
        unitPrice: newPrice,
        amount,
        taxable: newTaxable,
        taxAmount,
        incomeCategory: body.data.incomeCategory ?? line.incomeCategory,
        isManualOverride: true,
      })
      .where(eq(invoiceLinesTable.id, params.data.lineId));

    const allLines = await tx
      .select({
        amount: invoiceLinesTable.amount,
        taxAmount: invoiceLinesTable.taxAmount,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoice.id));
    const totals = totalLines(allLines);
    await tx
      .update(invoicesTable)
      .set({
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lastRecomputedAt: new Date(),
      })
      .where(eq(invoicesTable.id, invoice.id));
  });

  const [updatedLine] = await db
    .select()
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.id, params.data.lineId));
  res.json({ line: updatedLine });
});

// ──────────────────────────────────────────────────────────────────
// DELETE /invoices/:id — only on draft
// ──────────────────────────────────────────────────────────────────

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canEditInvoice(session, invoice)) {
    res.status(403).json({ error: "Cannot delete this invoice", code: "invoice.cannot_delete" });
    return;
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.id, invoice.id));
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────
// DELETE /invoices/:id/pushed/:provider — admin "Forget push record"
//
// Clears the local mapping row in `accounting_pushed_invoices` for
// (vendor, provider, invoice_number). The next bulk QBO/OA push will
// then re-create the invoice in the accounting product instead of
// skipping it as already-pushed. Used to recover from cases where the
// remote invoice was deleted in QBO/OA, or the wrong vendor was
// synced — without this action the operator would need a developer to
// hand-edit the database.
//
// Admin-only because (a) it has visible downstream effects on the next
// bulk push (re-creating an invoice in the customer's books) and (b)
// vendors who re-sync will see ghost charges if the local mapping and
// the remote state disagree. Audited via `recordExport` so deletes
// are traceable in the same audit feed as the bulk pushes that rely
// on the mapping rows.
// ──────────────────────────────────────────────────────────────────

const PushedProviderParams = z.object({
  id: z.coerce.number().int(),
  provider: z.enum(ACCOUNTING_PROVIDERS),
});

router.delete(
  "/invoices/:id/pushed/:provider",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
      return;
    }
    const params = PushedProviderParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
      return;
    }
    const [invoice] = await db
      .select({
        id: invoicesTable.id,
        vendorId: invoicesTable.vendorId,
        invoiceNumber: invoicesTable.invoiceNumber,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, params.data.id));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
      return;
    }
    const provider: AccountingProvider = params.data.provider;
    const deleted = await deletePushedInvoice(
      invoice.vendorId,
      provider,
      invoice.invoiceNumber,
    );
    if (!deleted) {
      // No mapping existed in the first place — return 404 so the UI
      // can disambiguate from a successful clear (which 200s) and
      // avoid writing a misleading audit row.
      res.status(404).json({
        error: "No push record exists for this invoice and provider.",
        code: "pushed.not_found",
      });
      return;
    }
    const auditLogId = await recordExport({
      req,
      reportKind:
        provider === "qbo"
          ? "vendor.quickbooksPush"
          : "vendor.openaccountantPush",
      format: provider === "qbo" ? "qbo_api_forget" : "oa_api_forget",
      scope: {
        vendorId: invoice.vendorId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        provider,
        // Snapshot of what we forgot so the audit trail still has the
        // remote primary key after the local row is gone.
        externalInvoiceId: deleted.externalInvoiceId,
        externalDocNumber: deleted.externalDocNumber,
        previouslyPushedAt: deleted.pushedAt.toISOString(),
        outcome: "forgotten",
      },
      rowCount: 1,
      fileBytes: 0,
    });
    res.json({
      ok: true,
      provider,
      invoiceNumber: invoice.invoiceNumber,
      externalInvoiceId: deleted.externalInvoiceId,
      externalDocNumber: deleted.externalDocNumber,
      auditLogId,
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /vendor-partner-billing-settings?vendorId&partnerId — read-only fetch
// PUT /vendor-partner-billing-settings — upsert (admin or owning vendor)
// ──────────────────────────────────────────────────────────────────

const SettingsQuery = z.object({
  vendorId: z.coerce.number().int(),
  partnerId: z.coerce.number().int(),
});

router.get("/vendor-partner-billing-settings", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const q = SettingsQuery.safeParse(req.query);
  if (!q.success) {
    sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
    return;
  }
  if (
    session.role !== "admin" &&
    !(session.role === "vendor" && session.vendorId === q.data.vendorId) &&
    !(session.role === "partner" && session.partnerId === q.data.partnerId)
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, q.data.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, q.data.partnerId),
      ),
    );
  res.json({ settings: row ?? null });
});

// Per-line-type 1099 income_category override map and the rest of this body
// shape live in `@workspace/api-zod` (UpdateVendorPartnerBillingSettingsBody)
// so the web admin UI and any future mobile/admin client validate the same
// contract the server enforces. Keys are validated against the live
// INVOICE_LINE_TYPES list and values against INVOICE_LINE_INCOME_CATEGORIES,
// so a malformed payload can never poison later invoice generation.

router.put("/vendor-partner-billing-settings", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const body = UpdateVendorPartnerBillingSettingsBody.safeParse(req.body);
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }
  if (
    session.role !== "admin" &&
    !(session.role === "vendor" && session.vendorId === body.data.vendorId) &&
    !(
      session.role === "partner" &&
      session.partnerId === body.data.partnerId &&
      session.membershipRole === "admin"
    )
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const [existing] = await db
    .select()
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, body.data.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, body.data.partnerId),
      ),
    );
  if (existing) {
    await db
      .update(vendorPartnerBillingSettingsTable)
      .set({
        ...(body.data.cadence !== undefined ? { cadence: body.data.cadence } : {}),
        ...(body.data.paymentTermsDays !== undefined
          ? { paymentTermsDays: body.data.paymentTermsDays }
          : {}),
        ...(body.data.remitToAddress !== undefined
          ? { remitToAddress: body.data.remitToAddress }
          : {}),
        ...(body.data.remitToName !== undefined
          ? { remitToName: body.data.remitToName }
          : {}),
        ...(body.data.mileageAutoSuggest !== undefined
          ? { mileageAutoSuggest: body.data.mileageAutoSuggest }
          : {}),
        ...(body.data.mileageRate !== undefined
          ? { mileageRate: body.data.mileageRate }
          : {}),
        ...(body.data.overtimeMultiplier !== undefined
          ? { overtimeMultiplier: body.data.overtimeMultiplier }
          : {}),
        ...(body.data.defaultIncomeCategoryOverrides !== undefined
          ? {
              defaultIncomeCategoryOverrides:
                body.data.defaultIncomeCategoryOverrides,
            }
          : {}),
        ...(body.data.lateFeeRule !== undefined
          ? { lateFeeRule: body.data.lateFeeRule }
          : {}),
      })
      .where(eq(vendorPartnerBillingSettingsTable.id, existing.id));
  } else {
    await db.insert(vendorPartnerBillingSettingsTable).values({
      vendorId: body.data.vendorId,
      partnerId: body.data.partnerId,
      cadence: body.data.cadence ?? "per_ticket",
      paymentTermsDays: body.data.paymentTermsDays ?? 30,
      remitToAddress: body.data.remitToAddress ?? null,
      remitToName: body.data.remitToName ?? null,
      mileageAutoSuggest: body.data.mileageAutoSuggest ?? false,
      mileageRate: body.data.mileageRate ?? null,
      overtimeMultiplier: body.data.overtimeMultiplier ?? "1.50",
      defaultIncomeCategoryOverrides:
        body.data.defaultIncomeCategoryOverrides ?? null,
      lateFeeRule: body.data.lateFeeRule ?? null,
    });
  }
  const [refreshed] = await db
    .select()
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, body.data.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, body.data.partnerId),
      ),
    );
  res.json({ settings: refreshed });
});

// ──────────────────────────────────────────────────────────────────
// Phase 3 — Send / Pay / Credit / Remind / PDF / Statements
// ──────────────────────────────────────────────────────────────────

// Status transitions caused by Phase 3 lifecycle events:
//   draft → sent      on first successful send
//   open|sent → paid  when balance hits zero (payment or credit memo)
//   paid → sent       if a payment is reversed (DELETE) and balance > 0
// 'overdue' is set by the daily aging worker, not by these routes.

type Money = string;

function balanceUnits(inv: {
  total: Money;
  paidAmount: Money;
  creditedAmount: Money;
}): bigint {
  return (
    toFixedUnits(inv.total) -
    toFixedUnits(inv.paidAmount) -
    toFixedUnits(inv.creditedAmount)
  );
}

function fmtUSD(s: Money): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function loadPdfInputs(invoiceId: number) {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));
  if (!invoice) return null;
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, invoice.vendorId));
  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, invoice.partnerId));
  const lines = await db
    .select()
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, invoice.id))
    .orderBy(invoiceLinesTable.ticketId, invoiceLinesTable.sortOrder);
  const payments = await db
    .select()
    .from(invoicePaymentsTable)
    .where(and(eq(invoicePaymentsTable.invoiceId, invoice.id), isNull(invoicePaymentsTable.voidedAt)))
    .orderBy(invoicePaymentsTable.paidAt);
  const credits = await db
    .select()
    .from(invoiceCreditMemosTable)
    .where(eq(invoiceCreditMemosTable.invoiceId, invoice.id))
    .orderBy(invoiceCreditMemosTable.createdAt);
  return { invoice, vendor, partner, lines, payments, credits };
}

// ──────────────────────────────────────────────────────────────────
// GET /invoices/:id/pdf — server-rendered PDF
// ──────────────────────────────────────────────────────────────────

router.get("/invoices/:id/pdf", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const data = await loadPdfInputs(p.data.id);
  if (!data || !data.vendor || !data.partner) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canSeeInvoice(session, data.invoice)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  // Partner viewers see the PDF in their preferred locale (matched via the
  // partner_contact whose email == their login email). Admin/vendor previews
  // stay English so internal review/QA is unaffected.
  let locale: "en" | "es" = "en";
  if (session.role === "partner" && session.userId && session.partnerId) {
    locale = await resolvePartnerSessionLocale({
      userId: session.userId,
      partnerId: session.partnerId,
    });
  }
  try {
    const buf = await renderInvoicePdf({
      locale,
      invoice: {
        id: data.invoice.id,
        invoiceNumber: data.invoice.invoiceNumber,
        status: data.invoice.status,
        cadence: data.invoice.cadence,
        periodStart: data.invoice.periodStart,
        periodEnd: data.invoice.periodEnd,
        dueDate: data.invoice.dueDate,
        remitToAddress: data.invoice.remitToAddress,
        remitToName: data.invoice.remitToName,
        notes: data.invoice.notes,
        subtotal: data.invoice.subtotal,
        taxTotal: data.invoice.taxTotal,
        total: data.invoice.total,
        paidAmount: data.invoice.paidAmount,
        creditedAmount: data.invoice.creditedAmount,
      },
      lines: data.lines.map((l) => ({
        id: l.id,
        ticketId: l.ticketId,
        afe: l.afe,
        lineType: l.lineType,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.amount,
        taxAmount: l.taxAmount,
        incomeCategory: l.incomeCategory,
      })),
      vendor: { name: data.vendor.name },
      partner: { name: data.partner.name },
      payments: data.payments.map((p) => ({
        paidAt: p.paidAt,
        method: p.method,
        referenceNumber: p.referenceNumber,
        amount: p.amount,
      })),
      credits: data.credits.map((c) => ({
        createdAt: c.createdAt,
        reason: c.reason,
        amount: c.amount,
      })),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${data.invoice.invoiceNumber}.pdf"`,
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (err) {
    logger.error({ err, invoiceId: p.data.id }, "Invoice PDF render failed");
    res.status(500).json({ error: "PDF render failed", code: "invoice.pdf_render_failed" });
  }
});

// ──────────────────────────────────────────────────────────────────
// POST /invoices/:id/send — render PDF + email + log + status=sent
// ──────────────────────────────────────────────────────────────────

const SendBody = z.object({
  toEmail: z.email().optional(),
  notes: z.string().max(2000).optional(),
});

router.post("/invoices/:id/send", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const body = SendBody.safeParse(req.body ?? {});
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }

  const data = await loadPdfInputs(p.data.id);
  if (!data || !data.vendor || !data.partner) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  // RBAC: vendor on the invoice or admin only.
  if (
    !(
      session.role === "admin" ||
      (session.role === "vendor" && session.vendorId === data.invoice.vendorId)
    )
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  // Status guard: already-paid or cancelled invoices are not sendable.
  if (
    data.invoice.status === "paid" ||
    data.invoice.status === "cancelled"
  ) {
    res
      .status(409)
      .json({ error: "Invoice is not in a sendable status", code: "invoice.not_sendable" });
    return;
  }

  const toEmail = await resolveBillingEmail({
    override: body.data.toEmail ?? null,
    cachedBillingEmail: data.invoice.billingContactEmail,
    partnerId: data.invoice.partnerId,
  });
  if (!toEmail) {
    res.status(400).json({
      error:
        "No recipient email. Provide toEmail or add a partner contact with the 'Billing Notifications' role.",
      code: "invoice.no_recipient",
    });
    return;
  }
  const recipientLocale = await resolveBillingLocale({
    email: toEmail,
    partnerId: data.invoice.partnerId,
  });

  // Render the PDF first; if rendering fails we don't write a send_log row
  // (caller can retry idempotently).
  let pdfBuf: Buffer;
  try {
    pdfBuf = await renderInvoicePdf({
      invoice: {
        id: data.invoice.id,
        invoiceNumber: data.invoice.invoiceNumber,
        status: "sent",
        cadence: data.invoice.cadence,
        periodStart: data.invoice.periodStart,
        periodEnd: data.invoice.periodEnd,
        dueDate: data.invoice.dueDate,
        remitToAddress: data.invoice.remitToAddress,
        remitToName: data.invoice.remitToName,
        notes: data.invoice.notes,
        subtotal: data.invoice.subtotal,
        taxTotal: data.invoice.taxTotal,
        total: data.invoice.total,
        paidAmount: data.invoice.paidAmount,
        creditedAmount: data.invoice.creditedAmount,
      },
      lines: data.lines.map((l) => ({
        id: l.id,
        ticketId: l.ticketId,
        afe: l.afe,
        lineType: l.lineType,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.amount,
        taxAmount: l.taxAmount,
        incomeCategory: l.incomeCategory,
      })),
      vendor: { name: data.vendor.name },
      partner: { name: data.partner.name },
      // Pass real payments through so the per-line 1099 form badges and
      // the "1099 form contributions" block on the emailed PDF reflect
      // any partial credit-card routing (NEC → 1099-K). Without this
      // the recipient would see NEC-only routing even when part of the
      // invoice was paid by card.
      payments: data.payments.map((p) => ({
        id: p.id,
        paidAt: p.paidAt,
        method: p.method,
        referenceNumber: p.referenceNumber,
        amount: p.amount,
      })),
      credits: data.credits.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        amount: c.amount,
        reason: c.reason,
      })),
      // Localize the 1099 category tags on the rendered PDF so they match
      // the language of the rest of the email/invoice the partner sees.
      // IIF/CSV exports stay English (US tax / accountant-facing).
      locale: recipientLocale,
    });
  } catch (err) {
    logger.error({ err, invoiceId: p.data.id }, "Send aborted: PDF render failed");
    res.status(500).json({ error: "PDF render failed", code: "invoice.pdf_render_failed" });
    return;
  }

  const balDue = unitsToString2(balanceUnits(data.invoice));

  // Best-effort email. Persist the attempt either way so the audit trail
  // is complete even if the SMTP layer is down.
  //
  // Status semantics, deliberately: status flips draft|open → sent and
  // dueDate/billingContactEmail are committed even when SendGrid returns
  // an error. "sent" here means "the vendor pressed Send and we have a
  // rendered PDF + an audit row in invoice_send_log"; whether SendGrid
  // actually relayed the message is a separate fact captured by
  // invoice_send_log.failureMessage and surfaced to the vendor via the
  // {sent:false, failureMessage} response (which the UI shows as a
  // destructive toast prompting Resend). Gating the status flip on
  // delivery success would conflate "failed to render/queue" with
  // "queued but bounced later" and would also mean a 5xx blip leaves
  // the invoice stuck in draft with no audit trail. Resend is supported
  // from sent/overdue precisely so a transient failure can be retried
  // without losing the original due-date anchor.
  let messageId: string | undefined;
  let failureMessage: string | null = null;
  try {
    const sent = await sendInvoiceEmail({
      to: toEmail,
      vendorName: data.vendor.name,
      partnerName: data.partner.name,
      invoiceNumber: data.invoice.invoiceNumber,
      totalDue: fmtUSD(balDue),
      dueDate: data.invoice.dueDate
        ? new Date(data.invoice.dueDate).toLocaleDateString(
            recipientLocale === "es" ? "es-MX" : "en-US",
          )
        : null,
      pdfBuf,
      notesFromSender: body.data.notes,
      locale: recipientLocale,
    });
    messageId = sent.messageId;
  } catch (err) {
    failureMessage = err instanceof Error ? err.message : String(err);
    logger.warn({ err, invoiceId: p.data.id }, "Invoice email send failed");
  }

  // Compute due_date if missing: now + paymentTermsDays. We don't override an
  // already-set due date.
  const now = new Date();
  let computedDueDate: Date | null = data.invoice.dueDate;
  if (!computedDueDate && data.invoice.paymentTermsDays) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + data.invoice.paymentTermsDays);
    computedDueDate = d;
  }

  // Persist the send_log + flip invoice to 'sent' (or keep 'sent' if already).
  // We commit the status transition even when email delivery fails — the
  // user pressed "Send", we recorded the intent, and the recipient is on
  // file. The log row carries the failureMessage so the audit trail is
  // accurate, and the UI surfaces a destructive toast + invites a retry.
  // Skipping the transition on email failure left invoices indefinitely
  // stuck in draft/open even after multiple send attempts (round-10 bug).
  await db.transaction(async (tx) => {
    await tx.insert(invoiceSendLogTable).values({
      invoiceId: data.invoice.id,
      sentToEmail: toEmail,
      sentByUserId: session.userId,
      sendgridMessageId: messageId ?? null,
      pdfBytes: pdfBuf.length,
      failureMessage,
    });
    await tx
      .update(invoicesTable)
      .set({
        status:
          data.invoice.status === "draft" || data.invoice.status === "open"
            ? "sent"
            : data.invoice.status,
        sentAt: data.invoice.sentAt ?? now,
        dueDate: computedDueDate,
        billingContactEmail: toEmail,
      })
      .where(eq(invoicesTable.id, data.invoice.id));
  });

  if (!failureMessage) {
    // Best-effort partner notification. The send + log + status flip
    // are already committed at this point; a notification-transport
    // failure must not turn a successful send into a 500, since the
    // vendor would then resend and double-fire emails. Log + swallow.
    try {
      const partnerUsers = await findPartnerBillingUserIds(
        data.invoice.partnerId,
      );
      await notifyUsers(partnerUsers, {
        type: "invoice_sent",
        title: `Invoice ${data.invoice.invoiceNumber} received`,
        body: `${data.vendor.name} sent you invoice ${data.invoice.invoiceNumber} for ${fmtUSD(balDue)}.`,
        link: `/invoices/${data.invoice.id}`,
        category: "system",
        dedupeKey: `invoice_sent:${data.invoice.id}:${Date.now()}`,
      });
    } catch (err) {
      logger.warn(
        { err, invoiceId: data.invoice.id },
        "invoice_sent partner notification failed (non-fatal)",
      );
    }
  }

  const [refreshed] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, data.invoice.id));
  res.json({
    invoice: refreshed,
    sent: !failureMessage,
    toEmail,
    messageId: messageId ?? null,
    failureMessage,
  });
});

// ──────────────────────────────────────────────────────────────────
// GET /invoices/:id/payments  +  GET /invoices/:id/credit-memos
// ──────────────────────────────────────────────────────────────────

router.get("/invoices/:id/payments", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canSeeInvoice(session, invoice)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const payments = await db
    .select()
    .from(invoicePaymentsTable)
    .where(and(eq(invoicePaymentsTable.invoiceId, invoice.id), isNull(invoicePaymentsTable.voidedAt)))
    .orderBy(invoicePaymentsTable.paidAt);
  res.json({ items: payments });
});

router.get("/invoices/:id/credit-memos", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (!canSeeInvoice(session, invoice)) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const credits = await db
    .select()
    .from(invoiceCreditMemosTable)
    .where(eq(invoiceCreditMemosTable.invoiceId, invoice.id))
    .orderBy(invoiceCreditMemosTable.createdAt);
  res.json({ items: credits });
});

// ──────────────────────────────────────────────────────────────────
// POST /invoices/:id/payments — record payment
// ──────────────────────────────────────────────────────────────────

const PaymentBody = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  paidAt: z.iso.datetime({ offset: true }).or(z.iso.date()),
  referenceNumber: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

router.post("/invoices/:id/payments", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const body = PaymentBody.safeParse(req.body ?? {});
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }

  const [pre] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!pre) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  // Only vendor staff and admins may record payments. Partners are explicitly
  // excluded: allowing partners to self-report payments lets them falsify
  // financial records, suppress collection views, and corrupt 1099 tax outputs
  // without any vendor review or confirmation.
  const isVendorOrAdmin =
    session.role === "admin" ||
    (session.role === "vendor" && session.vendorId === pre.vendorId);
  if (!isVendorOrAdmin) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (pre.status === "draft" || pre.status === "cancelled") {
    res.status(409).json({
      error: "Cannot record payment on draft or cancelled invoice",
      code: "invoice.not_payable",
    });
    return;
  }

  const amountUnits = toFixedUnits(body.data.amount);
  if (amountUnits <= 0n) {
    res.status(400).json({ error: "Amount must be positive", code: "invoice.amount_must_be_positive" });
    return;
  }

  const paidAtDate = new Date(body.data.paidAt);

  // Atomic balance update with row lock to avoid double-counting if two
  // payment writes race.
  type Outcome =
    | { ok: true; refreshed: Invoice; insertedId: number }
    | { ok: false; code: string; error: string };
  const result = await db.transaction(async (tx): Promise<Outcome> => {
    const lockedRows = await tx.execute<{
      id: number;
      total: string;
      paid_amount: string;
      credited_amount: string;
      status: string;
      paid_at: Date | null;
    }>(sql`
      select id, total, paid_amount, credited_amount, status, paid_at
      from invoices
      where id = ${pre.id}
      for update
    `);
    const locked = lockedRows.rows[0];
    if (!locked) {
      return { ok: false, code: "invoice.not_found", error: "Invoice not found" };
    }
    const totalU = toFixedUnits(locked.total);
    const paidU = toFixedUnits(locked.paid_amount);
    const credU = toFixedUnits(locked.credited_amount);
    const balanceU = totalU - paidU - credU;
    // Allow up to 1¢ rounding slop on overpay rejection.
    if (amountUnits > balanceU + 1n) {
      return {
        ok: false,
        code: "invoice.overpay",
        error: `Payment exceeds balance due (${unitsToString2(balanceU)})`,
      };
    }
    const inserted = await tx
      .insert(invoicePaymentsTable)
      .values({
        invoiceId: pre.id,
        method: body.data.method,
        referenceNumber: body.data.referenceNumber ?? null,
        amount: body.data.amount,
        paidAt: paidAtDate,
        recordedByUserId: session.userId,
        notes: body.data.notes ?? null,
        markedByPartner: false,
      })
      .returning({ id: invoicePaymentsTable.id });
    const insertedId = inserted[0]!.id;

    const newPaidU = paidU + amountUnits;
    const newBalanceU = totalU - newPaidU - credU;
    const closed = newBalanceU <= 0n;
    const newStatus = closed ? "paid" : locked.status;
    // paidAt: if closed, take MAX(existing paid_at, new payment paidAt).
    const newPaidAt = closed
      ? locked.paid_at && locked.paid_at > paidAtDate
        ? locked.paid_at
        : paidAtDate
      : locked.paid_at;

    await tx
      .update(invoicesTable)
      .set({
        paidAmount: unitsToString2(newPaidU),
        status: newStatus,
        paidAt: newPaidAt,
      })
      .where(eq(invoicesTable.id, pre.id));

    const [refreshed] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, pre.id));
    return { ok: true, refreshed: refreshed!, insertedId };
  });

  if (!result.ok) {
    // @allow-english-only-error — `result.code` is a discriminated-union
    // literal (`"invoice.overpay"` | `"invoice.over_paid"` etc.) emitted
    // inside the transaction above. All branches already use namespaced
    // codes with translations in the locale catalogs, but the static
    // checker can't see through the runtime expression.
    res.status(result.code === "invoice.overpay" ? 409 : 400).json({
      error: result.error,
      code: result.code,
    });
    return;
  }

  // Notify the partner that a payment has been recorded by the vendor/admin.
  try {
    const partnerUsers = await findPartnerBillingUserIds(pre.partnerId);
    await notifyUsers(partnerUsers, {
      type: "invoice_payment_recorded",
      title: `Payment recorded on Invoice ${pre.invoiceNumber}`,
      body: `${fmtUSD(body.data.amount)} recorded against ${pre.invoiceNumber}.`,
      link: `/invoices/${pre.id}`,
      category: "system",
      dedupeKey: `invoice_payment_recorded:${result.insertedId}`,
    });
  } catch (err) {
    logger.warn({ err }, "Payment notify failed (non-fatal)");
  }

  res.status(201).json({
    invoice: result.refreshed,
    payment: { id: result.insertedId },
    balanceDue: unitsToString2(balanceUnits(result.refreshed)),
  });
});

// ──────────────────────────────────────────────────────────────────
// DELETE /invoices/:id/payments/:pid — soft-delete (void) the payment
// and reopen the invoice if needed. Original row is preserved with
// voided_at/voided_by/voided_reason set; an invoice_payment_audit_log
// entry records who voided and why. Already-voided payments return 410.
// ──────────────────────────────────────────────────────────────────

const PaymentIdParams = z.object({
  id: z.coerce.number().int(),
  pid: z.coerce.number().int(),
});

const VoidPaymentBody = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

router.delete(
  "/invoices/:id/payments/:pid",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    const p = PaymentIdParams.safeParse(req.params);
    if (!p.success) {
      sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
      return;
    }
    const b = VoidPaymentBody.safeParse(req.body ?? {});
    if (!b.success) {
      sendValidationFailed(res, b.error, { code: "validation.invalid_input" });
      return;
    }
    const [pre] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, p.data.id));
    if (!pre) {
      res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
      return;
    }
    if (
      !(
        session.role === "admin" ||
        (session.role === "vendor" && session.vendorId === pre.vendorId)
      )
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute<{
        id: number;
        total: string;
        paid_amount: string;
        credited_amount: string;
        status: string;
      }>(sql`
        select id, total, paid_amount, credited_amount, status
        from invoices
        where id = ${pre.id}
        for update
      `);
      const locked = lockedRows.rows[0]!;
      const [payment] = await tx
        .select()
        .from(invoicePaymentsTable)
        .where(
          and(
            eq(invoicePaymentsTable.id, p.data.pid),
            eq(invoicePaymentsTable.invoiceId, pre.id),
          ),
        );
      if (!payment) return { ok: false as const, code: 404 };
      if (payment.voidedAt) return { ok: false as const, code: 410 };
      await tx
        .update(invoicePaymentsTable)
        .set({
          voidedAt: new Date(),
          voidedByUserId: session.userId,
          voidedReason: b.data.reason ?? null,
        })
        .where(eq(invoicePaymentsTable.id, payment.id));
      await tx.insert(invoicePaymentAuditLogTable).values({
        paymentId: payment.id,
        invoiceId: pre.id,
        action: "void",
        actorUserId: session.userId,
        reason: b.data.reason ?? null,
        amount: payment.amount,
      });
      const newPaidU =
        toFixedUnits(locked.paid_amount) - toFixedUnits(payment.amount);
      const newBalanceU =
        toFixedUnits(locked.total) -
        newPaidU -
        toFixedUnits(locked.credited_amount);
      const newStatus =
        locked.status === "paid" && newBalanceU > 0n ? "sent" : locked.status;
      await tx
        .update(invoicesTable)
        .set({
          paidAmount: unitsToString2(newPaidU < 0n ? 0n : newPaidU),
          status: newStatus,
          paidAt: newStatus === "paid" ? pre.paidAt : null,
        })
        .where(eq(invoicesTable.id, pre.id));
      const [refreshed] = await tx
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, pre.id));
      return { ok: true as const, refreshed: refreshed! };
    });
    if (!result.ok) {
      const msg =
        result.code === 410 ? "Payment already voided" : "Payment not found";
      const code =
        result.code === 410 ? "invoice.payment_already_voided" : "invoice.payment_not_found";
      // @allow-english-only-error — `code` is one of two namespaced
      // literals selected on the line above; the static checker can't see
      // through the local variable.
      res.status(result.code).json({ error: msg, code });
      return;
    }
    res.json({
      invoice: result.refreshed,
      balanceDue: unitsToString2(balanceUnits(result.refreshed)),
    });
  },
);

// ──────────────────────────────────────────────────────────────────
// POST /invoices/:id/credit-memos — issue credit memo
// ──────────────────────────────────────────────────────────────────

const CreditBody = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().min(1).max(500),
});

router.post("/invoices/:id/credit-memos", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const body = CreditBody.safeParse(req.body ?? {});
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }
  const [pre] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!pre) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  if (
    !(
      session.role === "admin" ||
      (session.role === "vendor" && session.vendorId === pre.vendorId)
    )
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (pre.status === "draft" || pre.status === "cancelled") {
    res.status(409).json({
      error: "Cannot issue credit memo on draft or cancelled invoice",
      code: "invoice.not_creditable",
    });
    return;
  }
  const amountUnits = toFixedUnits(body.data.amount);
  if (amountUnits <= 0n) {
    res.status(400).json({ error: "Amount must be positive", code: "invoice.amount_must_be_positive" });
    return;
  }

  type Outcome =
    | { ok: true; refreshed: Invoice; insertedId: number }
    | { ok: false; code: string; error: string };
  const result = await db.transaction(async (tx): Promise<Outcome> => {
    const lockedRows = await tx.execute<{
      id: number;
      total: string;
      paid_amount: string;
      credited_amount: string;
      status: string;
      paid_at: Date | null;
    }>(sql`
      select id, total, paid_amount, credited_amount, status, paid_at
      from invoices
      where id = ${pre.id}
      for update
    `);
    const locked = lockedRows.rows[0]!;
    const totalU = toFixedUnits(locked.total);
    const paidU = toFixedUnits(locked.paid_amount);
    const credU = toFixedUnits(locked.credited_amount);
    const balanceU = totalU - paidU - credU;
    if (amountUnits > balanceU + 1n) {
      return {
        ok: false,
        code: "invoice.over_credit",
        error: `Credit exceeds balance due (${unitsToString2(balanceU)})`,
      };
    }
    const inserted = await tx
      .insert(invoiceCreditMemosTable)
      .values({
        invoiceId: pre.id,
        amount: body.data.amount,
        reason: body.data.reason,
        createdByUserId: session.userId,
      })
      .returning({ id: invoiceCreditMemosTable.id });
    const newCredU = credU + amountUnits;
    const newBalanceU = totalU - paidU - newCredU;
    const closed = newBalanceU <= 0n;
    // paidAt only changes when this credit memo is what closes the
    // invoice. If the invoice already had a paidAt (e.g. status was
    // 'paid' before because of an earlier payment, or future logic
    // sets paidAt outside of the paid status), we leave it intact
    // rather than nulling it. This keeps paidAt as a true "closed at"
    // timestamp instead of getting clobbered by every subsequent memo.
    const updates: Record<string, unknown> = {
      creditedAmount: unitsToString2(newCredU),
      status: closed ? "paid" : locked.status,
    };
    if (closed && !locked.paid_at) {
      updates.paidAt = new Date();
    }
    await tx
      .update(invoicesTable)
      .set(updates)
      .where(eq(invoicesTable.id, pre.id));
    const [refreshed] = await tx
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, pre.id));
    return { ok: true, refreshed: refreshed!, insertedId: inserted[0]!.id };
  });
  if (!result.ok) {
    // @allow-english-only-error — `result.code` is the namespaced literal
    // `"invoice.over_credit"` set by the transaction's failure branch
    // above; the static checker can't see through the runtime expression.
    res.status(409).json({ error: result.error, code: result.code });
    return;
  }
  try {
    const partnerUsers = await findPartnerBillingUserIds(pre.partnerId);
    await notifyUsers(partnerUsers, {
      type: "invoice_credit_memo",
      title: `Credit memo issued on Invoice ${pre.invoiceNumber}`,
      body: `${fmtUSD(body.data.amount)} credited: ${body.data.reason}`,
      link: `/invoices/${pre.id}`,
      category: "system",
      dedupeKey: `invoice_credit_memo:${result.insertedId}`,
    });
  } catch (err) {
    logger.warn({ err }, "Credit memo notify failed (non-fatal)");
  }
  res.status(201).json({
    invoice: result.refreshed,
    creditMemo: { id: result.insertedId },
    balanceDue: unitsToString2(balanceUnits(result.refreshed)),
  });
});

// ──────────────────────────────────────────────────────────────────
// POST /invoices/:id/remind — manual reminder (best effort email)
// ──────────────────────────────────────────────────────────────────

const RemindBody = z.object({
  notes: z.string().max(2000).optional(),
  toEmail: z.email().optional(),
});

router.post("/invoices/:id/remind", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    sendValidationFailed(res, p.error, { code: "validation.invalid_input" });
    return;
  }
  const body = RemindBody.safeParse(req.body ?? {});
  if (!body.success) {
    sendValidationFailed(res, body.error, { code: "validation.invalid_input" });
    return;
  }
  const [pre] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, p.data.id));
  if (!pre) {
    res.status(404).json({ error: "Invoice not found", code: "invoice.not_found" });
    return;
  }
  // Manual reminders are allowed for vendor / admin / partner-on-self.
  if (
    !(
      session.role === "admin" ||
      (session.role === "vendor" && session.vendorId === pre.vendorId) ||
      (session.role === "partner" && session.partnerId === pre.partnerId)
    )
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  if (pre.status === "draft" || pre.status === "paid" || pre.status === "cancelled") {
    res.status(409).json({
      error: "Cannot remind a draft, paid, or cancelled invoice",
      code: "invoice.not_remindable",
    });
    return;
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, pre.vendorId));
  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, pre.partnerId));

  const toEmail = await resolveBillingEmail({
    override: body.data.toEmail ?? null,
    cachedBillingEmail: pre.billingContactEmail,
    partnerId: pre.partnerId,
  });
  const recipientLocale = await resolveBillingLocale({
    email: toEmail,
    partnerId: pre.partnerId,
  });

  // Two-layer dedupe:
  //   1. Rolling 24h check: refuses a new manual reminder if any prior
  //      manual reminder for this invoice was logged in the last 24h.
  //      Catches the normal "user clicks Remind again the next morning"
  //      case, regardless of UTC day boundary.
  //   2. UNIQUE 24h-bucket key: protects against two concurrent requests
  //      that both pass the rolling check before either commits — they
  //      will collide on the same bucket key and the 23505 conflict is
  //      surfaced to the loser as a 429 below.
  const recent = await db.execute<{ id: number }>(sql`
    select id from invoice_reminder_log
    where invoice_id = ${pre.id}
      and kind = 'manual'
      and sent_at > now() - interval '24 hours'
    limit 1
  `);
  if ((recent.rows ?? []).length > 0) {
    res.status(429).json({
      error: "A manual reminder was sent for this invoice within the last 24 hours",
      code: "invoice.reminder_throttled",
    });
    return;
  }
  const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const dedupeKey = `manual:${pre.id}:${bucket}`;

  const balDue = unitsToString2(balanceUnits(pre));
  const daysPastDue = pre.dueDate
    ? calcDaysPastDueUTC(new Date(pre.dueDate), new Date())
    : null;

  let messageId: string | undefined;
  let failureMessage: string | null = null;
  if (toEmail && vendor && partner) {
    try {
      const sent = await sendInvoiceReminderEmail({
        to: toEmail,
        vendorName: vendor.name,
        partnerName: partner.name,
        invoiceNumber: pre.invoiceNumber,
        balanceDue: fmtUSD(balDue),
        dueDate: pre.dueDate
          ? new Date(pre.dueDate).toLocaleDateString(
              recipientLocale === "es" ? "es-MX" : "en-US",
            )
          : null,
        daysPastDue,
        reminderKind: "manual",
        notesFromSender: body.data.notes,
        locale: recipientLocale,
      });
      messageId = sent.messageId;
    } catch (err) {
      failureMessage = err instanceof Error ? err.message : String(err);
      logger.warn({ err, invoiceId: pre.id }, "Manual reminder email failed");
    }
  } else if (!toEmail) {
    failureMessage = "no_recipient_email";
  }

  try {
    await db.insert(invoiceReminderLogTable).values({
      invoiceId: pre.id,
      kind: "manual",
      threshold: null,
      dedupeKey,
      sentToEmail: toEmail,
      sentByUserId: session.userId,
      notes: body.data.notes ?? null,
      failureMessage,
    });
  } catch (err) {
    // Race against another concurrent reminder for the same day. Treat as
    // throttled rather than 500.
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.status(429).json({
        error: "A manual reminder was already sent for this invoice today",
        code: "invoice.reminder_throttled",
      });
      return;
    }
    throw err;
  }

  // Best-effort in-app notify the other side.
  try {
    if (session.role === "partner") {
      const vendorUsers = await findVendorUserIds(pre.vendorId);
      await notifyUsers(vendorUsers, {
        type: "invoice_reminder",
        title: `Reminder: Invoice ${pre.invoiceNumber}`,
        body: body.data.notes ?? `Partner sent a reminder about ${pre.invoiceNumber}.`,
        link: `/invoices/${pre.id}`,
        category: "system",
      });
    } else {
      const partnerUsers = await findPartnerBillingUserIds(pre.partnerId);
      await notifyUsers(partnerUsers, {
        type: "invoice_reminder",
        title: `Reminder: Invoice ${pre.invoiceNumber}`,
        body:
          body.data.notes ??
          `Reminder about ${pre.invoiceNumber} (${fmtUSD(balDue)} due).`,
        link: `/invoices/${pre.id}`,
        category: "system",
      });
    }
  } catch (err) {
    logger.warn({ err }, "Reminder notify failed (non-fatal)");
  }

  res.status(201).json({
    sent: !failureMessage,
    toEmail,
    messageId: messageId ?? null,
    failureMessage,
  });
});

// ──────────────────────────────────────────────────────────────────
// GET /vendors/:vendorId/statement  +  GET /partners/:partnerId/statement
// ──────────────────────────────────────────────────────────────────

const StatementQuery = z.object({
  periodStart: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  periodEnd: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  // Optional counterparty filter. On the vendor endpoint this scopes to a
  // single partner; on the partner endpoint this scopes to a single vendor.
  // Required for the vendor↔partner pair view referenced by the UI.
  counterpartyId: z.coerce.number().int().positive().optional(),
  // 'open' (default) restricts to invoices with non-zero balance in
  // open/sent/overdue status — the typical "what do we still owe / are
  // owed" view. 'all' returns the full ledger including draft, paid, and
  // cancelled for accounting reconciliation.
  scope: z.enum(["open", "all"]).optional().default("open"),
});

async function buildStatement(opts: {
  vendorId?: number;
  partnerId?: number;
  periodStart?: string;
  periodEnd?: string;
  scope?: "open" | "all";
}) {
  const conds: ReturnType<typeof eq>[] = [];
  if (opts.vendorId) conds.push(eq(invoicesTable.vendorId, opts.vendorId));
  if (opts.partnerId) conds.push(eq(invoicesTable.partnerId, opts.partnerId));
  if (opts.periodStart)
    conds.push(gte(invoicesTable.periodStart, new Date(opts.periodStart)));
  if (opts.periodEnd)
    conds.push(lt(invoicesTable.periodStart, new Date(opts.periodEnd)));
  if ((opts.scope ?? "open") === "open") {
    conds.push(
      inArray(invoicesTable.status, ["open", "sent", "overdue"] as const),
    );
    // "open" semantically means "still owed money". Status alone can be
    // stale (e.g. an invoice fully covered by a payment + credit memo
    // before the status flip in the same txn was committed, or a row
    // touched only by the aging worker), so we also enforce a positive
    // balance directly in SQL: total - paid_amount - credited_amount > 0.
    conds.push(
      sql`(${invoicesTable.total}::numeric - ${invoicesTable.paidAmount}::numeric - ${invoicesTable.creditedAmount}::numeric) > 0`,
    );
  }

  // Resolve the "party" header: vendor or partner the statement is for.
  // We look it up unconditionally so the response always carries a name
  // even when the period has zero invoices.
  let party: { id: number; name: string } | null = null;
  if (opts.vendorId) {
    const [v] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, opts.vendorId));
    party = v ?? null;
  } else if (opts.partnerId) {
    const [p] = await db
      .select({ id: partnersTable.id, name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, opts.partnerId));
    party = p ?? null;
  }

  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      vendorId: invoicesTable.vendorId,
      partnerId: invoicesTable.partnerId,
      status: invoicesTable.status,
      periodStart: invoicesTable.periodStart,
      periodEnd: invoicesTable.periodEnd,
      dueDate: invoicesTable.dueDate,
      total: invoicesTable.total,
      paidAmount: invoicesTable.paidAmount,
      creditedAmount: invoicesTable.creditedAmount,
    })
    .from(invoicesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(invoicesTable.periodStart, invoicesTable.id);

  let runningU = 0n;
  let invoicedU = 0n;
  let paidU = 0n;
  let credU = 0n;
  const statementRows = rows.map((r) => {
    const t = toFixedUnits(r.total);
    const pa = toFixedUnits(r.paidAmount);
    const cr = toFixedUnits(r.creditedAmount);
    const bal = t - pa - cr;
    runningU += bal;
    invoicedU += t;
    paidU += pa;
    credU += cr;
    return {
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      dueDate: r.dueDate,
      total: r.total,
      paidAmount: unitsToString2(pa),
      creditedAmount: unitsToString2(cr),
      balanceDue: unitsToString2(bal),
      runningBalance: unitsToString2(runningU),
    };
  });

  return {
    party,
    periodStart: opts.periodStart ?? null,
    periodEnd: opts.periodEnd ?? null,
    totals: {
      invoiced: unitsToString2(invoicedU),
      paid: unitsToString2(paidU),
      credited: unitsToString2(credU),
      outstanding: unitsToString2(runningU),
    },
    rows: statementRows,
  };
}

router.get("/vendors/:vendorId/statement", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  const vendorId = Number(req.params["vendorId"]);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    res.status(400).json({ error: "Invalid vendorId", code: "vendor.invalid_id" });
    return;
  }
  if (
    !(
      session.role === "admin" ||
      (session.role === "vendor" && session.vendorId === vendorId)
    )
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const q = StatementQuery.safeParse(req.query);
  if (!q.success) {
    sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
    return;
  }
  const data = await buildStatement({
    vendorId,
    partnerId: q.data.counterpartyId,
    periodStart: q.data.periodStart,
    periodEnd: q.data.periodEnd,
    scope: q.data.scope,
  });
  res.json(data);
});

router.get(
  "/partners/:partnerId/statement",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
      return;
    }
    const partnerId = Number(req.params["partnerId"]);
    if (!Number.isInteger(partnerId) || partnerId <= 0) {
      res.status(400).json({ error: "Invalid partnerId", code: "partner.invalid_id" });
      return;
    }
    if (
      !(
        session.role === "admin" ||
        (session.role === "partner" && session.partnerId === partnerId)
      )
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const q = StatementQuery.safeParse(req.query);
    if (!q.success) {
      sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
      return;
    }
    const data = await buildStatement({
      partnerId,
      vendorId: q.data.counterpartyId,
      periodStart: q.data.periodStart,
      periodEnd: q.data.periodEnd,
      scope: q.data.scope,
    });
    res.json(data);
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /partners/:partnerId/1099-totals — year-end roll-up by category
// ──────────────────────────────────────────────────────────────────
//
// Sums `invoice_lines.amount` grouped by `income_category` across every
// non-cancelled invoice that belongs to this partner whose
// `period_start` falls in the requested range. Designed for accountants
// generating year-end 1099s — they can see at a glance how much of the
// partner's spend lands in each 1099 box without having to open every
// invoice individually.
//
// Range: callers may pass `?year=YYYY` (defaults to the current calendar
// year) OR an arbitrary `?from=ISO&to=ISO` half-open interval. `from`
// is inclusive, `to` is exclusive. When both `year` and `from`/`to` are
// supplied, the explicit `from`/`to` win.
//
// Authorization: admin OR the partner-on-the-invoices. Vendors do NOT
// see this — a partner's full per-category 1099 roll-up exposes spend
// across other vendors. Mirrors `rbacPartner` in routes/reports.ts.
const Totals1099Query = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
});

router.get(
  "/partners/:partnerId/1099-totals",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        error: "Not authenticated",
        code: "auth.not_authenticated",
      });
      return;
    }
    const partnerId = Number(req.params.partnerId);
    if (!Number.isInteger(partnerId)) {
      res.status(400).json({
        error: "Bad partnerId",
        code: "partner.invalid_id",
      });
      return;
    }
    if (
      session.role !== "admin" &&
      !(session.role === "partner" && session.partnerId === partnerId)
    ) {
      res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
      return;
    }
    const q = Totals1099Query.safeParse(req.query);
    if (!q.success) {
      sendValidationFailed(res, q.error, { code: "validation.invalid_input" });
      return;
    }
    const year = q.data.year ?? new Date().getUTCFullYear();
    const fromDate = q.data.from
      ? new Date(q.data.from)
      : new Date(Date.UTC(year, 0, 1));
    const toDate = q.data.to
      ? new Date(q.data.to)
      : new Date(Date.UTC(year + 1, 0, 1));

    const rows = await db
      .select({
        incomeCategory: invoiceLinesTable.incomeCategory,
        amount: sql<string>`COALESCE(SUM(${invoiceLinesTable.amount}::numeric), 0)::numeric(14,2)`,
        lineCount: sql<number>`COUNT(*)::int`,
      })
      .from(invoiceLinesTable)
      .innerJoin(
        invoicesTable,
        eq(invoicesTable.id, invoiceLinesTable.invoiceId),
      )
      .where(
        and(
          eq(invoicesTable.partnerId, partnerId),
          // Exclude cancelled invoices — those lines were never billed.
          // Drafts ARE included so accountants can preview the
          // year-to-date roll-up before invoices are sent.
          sql`${invoicesTable.status} <> 'cancelled'`,
          gte(invoicesTable.periodStart, fromDate),
          lt(invoicesTable.periodStart, toDate),
        ),
      )
      .groupBy(invoiceLinesTable.incomeCategory);

    // Always return one entry per known category so the UI can render a
    // stable table (zeroes included) without doing the merge itself.
    const byCat = new Map(rows.map((r) => [r.incomeCategory, r]));
    const totals = INVOICE_LINE_INCOME_CATEGORIES.map((cat) => {
      const r = byCat.get(cat);
      return {
        incomeCategory: cat,
        amount: r?.amount ?? "0.00",
        lineCount: r?.lineCount ?? 0,
      };
    });
    const grandTotalU = totals.reduce(
      (acc, t) => acc + toFixedUnits(t.amount),
      0n,
    );

    res.json({
      partnerId,
      year,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      totals,
      grandTotal: unitsToString2(grandTotalU),
    });
  },
);

export default router;
