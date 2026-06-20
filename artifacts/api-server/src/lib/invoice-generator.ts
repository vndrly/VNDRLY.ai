// Orchestrator: loads ticket data, picks the target invoice (cadence + sent-
// invoice → supplemental rule), calls the pure engine, and persists lines.
//
// Idempotency: each ticket has at most one set of NON-MANUAL-OVERRIDE lines
// in any invoice. Re-running for the same ticket deletes those lines and
// re-emits them; lines marked is_manual_override=true survive.
//
// Sent-invoice immutability: if the existing target invoice is not in
// status='draft', a fresh draft "supplemental" invoice is opened
// (supplemental_of_invoice_id pointing to the most recent prior invoice in
// that period) and the lines land there.

import { and, eq, sql, desc } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketCheckInsTable,
  ticketAssignmentRatesTable,
  ticketLineItemsTable,
  vendorsTable,
  vendorPeopleTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  partnersTable,
  workTypesTable,
  taxRatesTable,
  invoicesTable,
  invoiceLinesTable,
  invoiceTicketLinksTable,
  invoiceRateCardSnapshotsTable,
  vendorPartnerBillingSettingsTable,
  vendorWorkTypesTable,
  partnerVendorWorkTypeApprovalsTable,
  resolveEffectiveTaxTreatment,
  type TaxTreatment,
  type Invoice,
  type LateFeeRule,
} from "@workspace/db";
import {
  buildInvoiceLinesForTicket,
  totalLines,
  type EngineTicketContext,
  type EngineLine,
  type EngineSnapshot,
} from "./invoice-engine";
import { logger } from "./logger";

// A handle that can run drizzle queries: either the root db OR a transaction
// handle yielded by db.transaction(). Used so the regenerate route can wrap
// every per-ticket generation in a single tx (atomic regeneration).
type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Postgres advisory-lock namespace for invoice generation. The two-int
// form `pg_advisory_xact_lock(int4, int4)` is keyed by (namespace, ticketId)
// so we don't collide with any other advisory lock the system may use in the
// future. Picked a stable arbitrary constant — never change it without
// migrating callers, otherwise an old replica still using the old constant
// would NOT block against a new replica using the new one.
const ADVISORY_LOCK_NS_INVOICE_GEN = 0x1949c01;

export type GenerationResult =
  | { ok: true; invoiceId: number; supplemental: boolean; lineCount: number }
  | { ok: false; reason: string };

/**
 * Generate (or regenerate) invoice lines for a single ticket, idempotently.
 * Safe to call multiple times — non-manual-override lines for the ticket
 * are replaced on each call.
 *
 * Cluster-wide concurrency: the entire body runs inside a transaction that
 * holds a Postgres tx-scoped advisory lock keyed by ticketId. Two replicas
 * (or two requests on the same replica) hitting the same ticket take turns
 * — the second waits until the first commits before starting. Different
 * tickets remain fully parallel.
 */
export async function generateInvoiceForTicket(
  ticketId: number,
  // Optional invariant from the regenerate path: if provided, the resolver
  // MUST land on this exact invoice id, otherwise we abort BEFORE writing.
  // Closes the TOCTOU window between route-level preflight and the write.
  expectedInvoiceId?: number,
  // Optional executor — pass a transaction handle so a multi-ticket
  // regeneration can wrap ALL ticket generations in a single tx. If a later
  // ticket fails (e.g. target_changed), the caller throws and Postgres rolls
  // back every previously-written line, ticket link, totals update and
  // snapshot insert in this batch — atomic regeneration.
  executor: DbExecutor = db,
): Promise<GenerationResult> {
  // Wrap in a tx (or reuse the caller's) so we can hold a tx-scoped
  // advisory lock that serializes ALL phases (load, resolve, write) for
  // this ticket cluster-wide. The lock is automatically released when the
  // tx ends — no leak risk on crash. pg_advisory_xact_lock is reentrant
  // within the same tx, so the regenerate route can loop over multiple
  // tickets without recursion issues.
  const runLocked = async (tx: DbTx): Promise<GenerationResult> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NS_INVOICE_GEN}::int, ${ticketId}::int)`,
    );
    return generateInvoiceForTicketInner(ticketId, expectedInvoiceId, tx);
  };
  if (executor === db) {
    return db.transaction(runLocked);
  }
  // Caller already has a tx — acquire the lock on it directly. The lock
  // remains held until the OUTER tx ends, even though our inner write phase
  // (below) opens a savepoint via tx.transaction.
  return runLocked(executor as DbTx);
}

async function generateInvoiceForTicketInner(
  ticketId: number,
  expectedInvoiceId: number | undefined,
  executor: DbTx,
): Promise<GenerationResult> {
  // 1. Load ticket + joins
  const [ticket] = await executor
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      siteLocationId: ticketsTable.siteLocationId,
      workTypeId: ticketsTable.workTypeId,
      status: ticketsTable.status,
      approvedAt: ticketsTable.approvedAt,
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) return { ok: false, reason: "ticket_not_found" };
  if (ticket.status !== "approved") {
    return { ok: false, reason: `ticket_status_not_approved:${ticket.status}` };
  }
  // Period resolution must use the IMMUTABLE approval timestamp so that
  // subsequent edits to the ticket (which bump updatedAt) cannot silently
  // shift charges to a different invoice. Tickets approved before this
  // column existed fall back to updatedAt for backwards compatibility.
  const approvedAt = ticket.approvedAt ?? ticket.updatedAt ?? new Date();

  const [site] = await executor
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, ticket.siteLocationId));
  if (!site) return { ok: false, reason: "site_not_found" };

  const [vendor] = await executor
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, ticket.vendorId));
  if (!vendor) return { ok: false, reason: "vendor_not_found" };

  const [partner] = await executor
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, site.partnerId));
  if (!partner) return { ok: false, reason: "partner_not_found" };

  const [workType] = await executor
    .select()
    .from(workTypesTable)
    .where(eq(workTypesTable.id, ticket.workTypeId));

  // AFE preference: site_work_assignment > site fallback. Phase 1 was supposed
  // to provide a richer AFE resolver — for now this gives a deterministic
  // value that the partner can drill on.
  const [afeAssignment] = await executor
    .select({ afe: siteWorkAssignmentsTable.afe })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, ticket.siteLocationId),
        eq(siteWorkAssignmentsTable.vendorId, ticket.vendorId),
        eq(siteWorkAssignmentsTable.workTypeId, ticket.workTypeId),
      ),
    );
  const afe = afeAssignment?.afe ?? site.afe ?? null;

  // Order by checkInAt ASC so weekly-OT reverse-walk (which converts the
  // latest hours of the week from regular→OT) operates on the correct
  // chronological ordering when an employee has multiple shifts on the same
  // day with different rates.
  const checkInRows = await executor
    .select({
      id: ticketCheckInsTable.id,
      ticketId: ticketCheckInsTable.ticketId,
      employeeId: ticketCheckInsTable.employeeId,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(ticketCheckInsTable)
    .leftJoin(
      vendorPeopleTable,
      eq(vendorPeopleTable.id, ticketCheckInsTable.employeeId),
    )
    .where(eq(ticketCheckInsTable.ticketId, ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);

  const assignmentRows = await executor
    .select()
    .from(ticketAssignmentRatesTable)
    .where(eq(ticketAssignmentRatesTable.ticketId, ticketId));

  const lineItemRows = await executor
    .select()
    .from(ticketLineItemsTable)
    .where(eq(ticketLineItemsTable.ticketId, ticketId));

  const taxRateRow = site.state
    ? (
        await executor
          .select()
          .from(taxRatesTable)
          .where(eq(taxRatesTable.state, site.state))
      )[0]
    : undefined;

  const combined =
    site.combinedTaxRate != null
      ? String(site.combinedTaxRate)
      : site.merchandiseTaxRate != null
        ? String(site.merchandiseTaxRate)
        : taxRateRow?.rate ?? null;
  const stateRate =
    site.stateTaxRate != null
      ? String(site.stateTaxRate)
      : site.laborTaxRate != null
        ? String(site.laborTaxRate)
        : taxRateRow?.rate ?? null;
  const localRate =
    site.localTaxRate != null ? String(site.localTaxRate) : "0.0000";

  const taxJurisdiction =
    combined && stateRate
      ? {
          state: site.state ?? null,
          postalCode: site.taxJurisdictionPostalCode ?? null,
          jurisdictionLabel: site.taxJurisdictionLabel ?? null,
          stateTaxRate: stateRate,
          localTaxRate: localRate,
          combinedTaxRate: combined,
          laborTaxRate: stateRate,
          merchandiseTaxRate: combined,
        }
      : taxRateRow
        ? {
            state: taxRateRow.state,
            postalCode: site.taxJurisdictionPostalCode ?? null,
            jurisdictionLabel: site.taxJurisdictionLabel ?? null,
            stateTaxRate: taxRateRow.rate,
            localTaxRate: "0.0000",
            combinedTaxRate: taxRateRow.rate,
            laborTaxRate: taxRateRow.rate,
            merchandiseTaxRate: taxRateRow.rate,
          }
        : null;

  const [vendorWorkTypeRow] = await executor
    .select({ taxTreatment: vendorWorkTypesTable.taxTreatment })
    .from(vendorWorkTypesTable)
    .where(
      and(
        eq(vendorWorkTypesTable.vendorId, ticket.vendorId),
        eq(vendorWorkTypesTable.workTypeId, ticket.workTypeId),
      ),
    )
    .limit(1);

  const [partnerApprovalRow] = await executor
    .select({ taxTreatment: partnerVendorWorkTypeApprovalsTable.taxTreatment })
    .from(partnerVendorWorkTypeApprovalsTable)
    .where(
      and(
        eq(partnerVendorWorkTypeApprovalsTable.partnerId, site.partnerId),
        eq(partnerVendorWorkTypeApprovalsTable.vendorId, ticket.vendorId),
        eq(partnerVendorWorkTypeApprovalsTable.workTypeId, ticket.workTypeId),
      ),
    )
    .limit(1);

  const workTypeTaxTreatment = (workType?.taxTreatment ?? null) as TaxTreatment | null;
  const vendorWorkTypeTaxTreatment = (vendorWorkTypeRow?.taxTreatment ??
    null) as TaxTreatment | null;
  const partnerWorkTypeTaxTreatment = (partnerApprovalRow?.taxTreatment ??
    null) as TaxTreatment | null;
  const effectiveTaxTreatment = resolveEffectiveTaxTreatment({
    partnerTreatment: partnerWorkTypeTaxTreatment,
    vendorTreatment: vendorWorkTypeTaxTreatment,
    workTypeTreatment: workTypeTaxTreatment,
    workTypeCategory: workType?.category ?? null,
    state: site.state,
  });

  // Billing settings: load or default.
  const [billingRow] = await executor
    .select()
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, ticket.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, site.partnerId),
      ),
    );

  const cadence = (billingRow?.cadence ?? "per_ticket") as
    | "per_ticket"
    | "weekly"
    | "monthly";
  const paymentTermsDays = billingRow?.paymentTermsDays ?? 30;
  const otMultiplier = billingRow?.overtimeMultiplier ?? "1.50";

  const ctx: EngineTicketContext = {
    ticketId,
    approvedAt,
    afe,
    workTypeName: workType?.name ?? null,
    workTypeCategory: workType?.category ?? null,
    workTypeTaxTreatment,
    vendorWorkTypeTaxTreatment,
    partnerWorkTypeTaxTreatment,
    effectiveTaxTreatment,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      dailyOtHours: vendor.dailyOtHours ?? null,
      weeklyOtHours: vendor.weeklyOtHours ?? null,
    },
    site: { id: site.id, name: site.name, state: site.state ?? null },
    partner: { id: partner.id, name: partner.name },
    taxRate: taxRateRow ? { state: taxRateRow.state, rate: taxRateRow.rate } : null,
    taxJurisdiction,
    billing: {
      cadence,
      paymentTermsDays,
      remitToAddress: billingRow?.remitToAddress ?? null,
      remitToName: billingRow?.remitToName ?? null,
      mileageAutoSuggest: billingRow?.mileageAutoSuggest ?? false,
      mileageRate: billingRow?.mileageRate ?? null,
      overtimeMultiplier: otMultiplier,
      lateFeeRule: billingRow?.lateFeeRule ?? null,
      incomeCategoryOverrides: billingRow?.defaultIncomeCategoryOverrides ?? null,
    },
    checkIns: checkInRows.map((r) => ({
      id: r.id,
      ticketId: r.ticketId,
      employeeId: r.employeeId,
      employeeName:
        r.firstName || r.lastName
          ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()
          : null,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
      hourlyRateAtTime: r.hourlyRateAtTime ?? null,
    })),
    assignmentRates: assignmentRows.map((r) => ({
      ticketId: r.ticketId,
      employeeId: r.employeeId,
      hourlyRate: r.hourlyRate,
    })),
    lineItems: lineItemRows.map((r) => ({
      id: r.id,
      ticketId: r.ticketId,
      type: r.type,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      taxableOverride: r.taxableOverride,
    })),
    totalGpsMiles: null,
  };

  const { lines, snapshot } = buildInvoiceLinesForTicket(ctx);

  // Resolve target invoice (cadence + sent-invoice → supplemental rule).
  // Retry once on unique-violation (race with another concurrent generation
  // for the same period — DB partial unique index pinches the second writer
  // and we re-resolve into the now-existing draft).
  let invoiceMeta: { invoiceId: number; supplemental: boolean };
  const resolveArgs: ResolveArgs = {
    vendorId: vendor.id,
    partnerId: partner.id,
    cadence,
    paymentTermsDays,
    approvedAt: ctx.approvedAt,
    remitToAddress: ctx.billing.remitToAddress,
    remitToName: ctx.billing.remitToName,
    lateFeeRule: ctx.billing.lateFeeRule,
    ticketId,
  };
  try {
    invoiceMeta = await resolveTargetInvoice(resolveArgs, executor);
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      invoiceMeta = await resolveTargetInvoice(resolveArgs, executor);
    } else {
      throw err;
    }
  }

  // TOCTOU close: callers (e.g. the regenerate route) can pass an expected
  // invoice id. If live data has shifted between their preflight and now and
  // the resolver lands somewhere else, abort BEFORE writing a single line.
  if (
    expectedInvoiceId !== undefined &&
    invoiceMeta.invoiceId !== expectedInvoiceId
  ) {
    return {
      ok: false,
      reason: `target_changed:expected=${expectedInvoiceId}:resolved=${invoiceMeta.invoiceId}`,
    };
  }

  // Persist lines + ticket link + recompute totals + write snapshot.
  await executor.transaction(async (tx) => {
    // Delete existing NON-manual-override lines for this ticket on this invoice.
    await tx
      .delete(invoiceLinesTable)
      .where(
        and(
          eq(invoiceLinesTable.invoiceId, invoiceMeta.invoiceId),
          eq(invoiceLinesTable.ticketId, ticketId),
          eq(invoiceLinesTable.isManualOverride, false),
        ),
      );

    // Collect source-keys of SURVIVING manual override lines on this ticket so
    // we can suppress the generator's replacement for the same source. Without
    // this, a user-edited line and a freshly generated line for the same
    // (sourceType, sourceId) would both end up on the invoice and double-bill
    // the customer.
    const overrideRows = await tx
      .select({
        sourceType: invoiceLinesTable.sourceType,
        sourceId: invoiceLinesTable.sourceId,
      })
      .from(invoiceLinesTable)
      .where(
        and(
          eq(invoiceLinesTable.invoiceId, invoiceMeta.invoiceId),
          eq(invoiceLinesTable.ticketId, ticketId),
          eq(invoiceLinesTable.isManualOverride, true),
        ),
      );
    const overrideKeys = new Set(
      overrideRows.map((r) => `${r.sourceType}|${r.sourceId ?? "null"}`),
    );
    const linesToInsert = lines.filter(
      (l) => !overrideKeys.has(`${l.sourceType}|${l.sourceId ?? "null"}`),
    );

    if (linesToInsert.length > 0) {
      await tx.insert(invoiceLinesTable).values(
        linesToInsert.map((l) => ({
          invoiceId: invoiceMeta.invoiceId,
          ticketId: l.ticketId,
          sourceType: l.sourceType,
          sourceId: l.sourceId,
          afe: l.afe,
          lineType: l.lineType,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          amount: l.amount,
          taxable: l.taxable,
          taxState: l.taxState,
          taxRate: l.taxRate,
          taxAmount: l.taxAmount,
          incomeCategory: l.incomeCategory,
          isManualOverride: false,
          sortOrder: l.sortOrder,
        })),
      );
    }

    // Upsert ticket link.
    await tx
      .insert(invoiceTicketLinksTable)
      .values({
        invoiceId: invoiceMeta.invoiceId,
        ticketId,
        approvedAt: ctx.approvedAt,
      })
      .onConflictDoNothing();

    // Re-total the invoice from ALL its lines (including manual overrides
    // and lines from other tickets on the same multi-ticket invoice).
    const allLines = await tx
      .select({
        amount: invoiceLinesTable.amount,
        taxAmount: invoiceLinesTable.taxAmount,
      })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoiceMeta.invoiceId));
    const totals = totalLines(allLines);
    await tx
      .update(invoicesTable)
      .set({
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lastRecomputedAt: new Date(),
      })
      .where(eq(invoicesTable.id, invoiceMeta.invoiceId));

    // Snapshot input data for audit — APPEND-ONLY. Each (invoice, ticket)
    // generation appends a new row so the full history of inputs (rates, tax
    // rate, OT thresholds) per ticket is preserved on multi-ticket invoices.
    // Prior rows are never overwritten.
    await tx.insert(invoiceRateCardSnapshotsTable).values({
      invoiceId: invoiceMeta.invoiceId,
      ticketId,
      snapshot,
    });
  });

  return {
    ok: true,
    invoiceId: invoiceMeta.invoiceId,
    supplemental: invoiceMeta.supplemental,
    lineCount: lines.length,
  };
}

// ──────────────────────────────────────────────────────────────────
// Cadence + supplemental resolution
// ──────────────────────────────────────────────────────────────────

type ResolveArgs = {
  vendorId: number;
  partnerId: number;
  cadence: "per_ticket" | "weekly" | "monthly";
  paymentTermsDays: number;
  approvedAt: Date;
  remitToAddress: string | null;
  remitToName: string | null;
  lateFeeRule: LateFeeRule | null;
  // Required for per_ticket cadence so the resolver can locate (or create)
  // the ticket-specific invoice via invoice_ticket_links rather than
  // collapsing all same-day tickets into one invoice.
  ticketId: number;
};

function periodForCadence(
  cadence: "per_ticket" | "weekly" | "monthly",
  approvedAt: Date,
): { periodStart: Date; periodEnd: Date } {
  if (cadence === "weekly") {
    // ISO week (Mon-Sun) in UTC.
    const d = new Date(
      Date.UTC(approvedAt.getUTCFullYear(), approvedAt.getUTCMonth(), approvedAt.getUTCDate()),
    );
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1); // Monday
    const periodStart = new Date(d.getTime());
    const periodEnd = new Date(d.getTime());
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
    return { periodStart, periodEnd };
  }
  if (cadence === "monthly") {
    const periodStart = new Date(
      Date.UTC(approvedAt.getUTCFullYear(), approvedAt.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(approvedAt.getUTCFullYear(), approvedAt.getUTCMonth() + 1, 1),
    );
    return { periodStart, periodEnd };
  }
  // per_ticket
  const periodStart = new Date(
    Date.UTC(approvedAt.getUTCFullYear(), approvedAt.getUTCMonth(), approvedAt.getUTCDate()),
  );
  const periodEnd = new Date(periodStart.getTime());
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
  return { periodStart, periodEnd };
}

// Preflight helper used by the regenerate API: returns the period tuple a
// ticket would resolve into WITHOUT touching invoices_table. Lets callers
// detect that a regeneration would land on a different invoice (e.g. ticket
// was reassigned to a different site/vendor since invoice creation, or the
// billing cadence changed) BEFORE any writes happen.
export async function computeTargetPeriodForTicket(
  ticketId: number,
): Promise<
  | { ok: false; reason: string }
  | {
      ok: true;
      vendorId: number;
      partnerId: number;
      cadence: "per_ticket" | "weekly" | "monthly";
      periodStart: Date;
      periodEnd: Date;
    }
> {
  const [ticket] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      siteLocationId: ticketsTable.siteLocationId,
      status: ticketsTable.status,
      approvedAt: ticketsTable.approvedAt,
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) return { ok: false, reason: "ticket_not_found" };

  const [site] = await db
    .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, ticket.siteLocationId));
  if (!site) return { ok: false, reason: "site_not_found" };

  const [billingRow] = await db
    .select({ cadence: vendorPartnerBillingSettingsTable.cadence })
    .from(vendorPartnerBillingSettingsTable)
    .where(
      and(
        eq(vendorPartnerBillingSettingsTable.vendorId, ticket.vendorId),
        eq(vendorPartnerBillingSettingsTable.partnerId, site.partnerId),
      ),
    );

  const cadence = (billingRow?.cadence ?? "per_ticket") as
    | "per_ticket"
    | "weekly"
    | "monthly";
  // Same immutable-timestamp invariant as generateInvoiceForTicket.
  const approvedAt = ticket.approvedAt ?? ticket.updatedAt ?? new Date();
  const { periodStart, periodEnd } = periodForCadence(cadence, approvedAt);
  return {
    ok: true,
    vendorId: ticket.vendorId,
    partnerId: site.partnerId,
    cadence,
    periodStart,
    periodEnd,
  };
}

async function resolveTargetInvoice(args: ResolveArgs, executor: DbExecutor = db): Promise<{
  invoiceId: number;
  supplemental: boolean;
}> {
  const { periodStart, periodEnd } = periodForCadence(args.cadence, args.approvedAt);

  // Per-ticket cadence: each approved ticket gets its OWN invoice. We never
  // collapse multiple same-day same-vendor/partner tickets onto one invoice.
  // Locate any existing per_ticket invoice for THIS ticket via the link table
  // (idempotent regen). If none, create a brand-new invoice.
  let existingList: typeof invoicesTable.$inferSelect[];
  if (args.cadence === "per_ticket") {
    existingList = await executor
      .select()
      .from(invoicesTable)
      .innerJoin(
        invoiceTicketLinksTable,
        eq(invoiceTicketLinksTable.invoiceId, invoicesTable.id),
      )
      .where(
        and(
          eq(invoicesTable.cadence, "per_ticket"),
          eq(invoiceTicketLinksTable.ticketId, args.ticketId),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .then((rows) => rows.map((r) => r.invoices));
  } else {
    // Period-bucketed cadence (weekly/monthly): look for existing invoice in
    // this period.
    existingList = await executor
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.vendorId, args.vendorId),
          eq(invoicesTable.partnerId, args.partnerId),
          eq(invoicesTable.cadence, args.cadence),
          eq(invoicesTable.periodStart, periodStart),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt));
  }

  // If a draft exists, append to it.
  const draft = existingList.find((i) => i.status === "draft");
  if (draft) {
    return { invoiceId: draft.id, supplemental: false };
  }

  // If a non-draft (sent/paid/etc.) exists but no draft → create supplemental draft.
  const supplementalOf = existingList[0]?.id ?? null;

  const dueDate = new Date(args.approvedAt.getTime());
  dueDate.setUTCDate(dueDate.getUTCDate() + args.paymentTermsDays);

  const invoiceNumber = await mintInvoiceNumber(
    args.vendorId,
    args.partnerId,
    args.cadence,
    periodStart,
  );

  const [created] = await executor
    .insert(invoicesTable)
    .values({
      invoiceNumber,
      vendorId: args.vendorId,
      partnerId: args.partnerId,
      cadence: args.cadence,
      status: "draft",
      periodStart,
      periodEnd,
      dueDate,
      paymentTermsDays: args.paymentTermsDays,
      remitToAddress: args.remitToAddress,
      remitToName: args.remitToName,
      lateFeeRule: args.lateFeeRule ?? null,
      supplementalOfInvoiceId: supplementalOf,
    })
    .returning();

  return { invoiceId: created.id, supplemental: supplementalOf != null };
}

async function mintInvoiceNumber(
  vendorId: number,
  partnerId: number,
  cadence: string,
  periodStart: Date,
): Promise<string> {
  // Format: INV-{vendor}-{partner}-{cadence}-{YYYYMMDD}-{nonce}
  const yyyymmdd =
    periodStart.getUTCFullYear().toString().padStart(4, "0") +
    (periodStart.getUTCMonth() + 1).toString().padStart(2, "0") +
    periodStart.getUTCDate().toString().padStart(2, "0");
  const nonce = Date.now().toString(36).slice(-5).toUpperCase();
  return `INV-${vendorId}-${partnerId}-${cadence.slice(0, 3).toUpperCase()}-${yyyymmdd}-${nonce}`;
}

// ──────────────────────────────────────────────────────────────────
// Fire-and-forget scheduling
// ──────────────────────────────────────────────────────────────────

// In-process coalescing per ticket: a second call while a generation is
// already running on THIS replica returns the in-flight promise instead of
// starting a duplicate run. This is purely a perf optimisation that saves
// DB round-trips when an approve hook and a regenerate click race on the
// same Node process.
//
// Cluster-wide safety does NOT depend on this map — it lives in the
// pg_advisory_xact_lock acquired at the top of generateInvoiceForTicket.
// Two REPLICAS hitting the same ticket bypass this map entirely (it's
// per-process) but still serialize correctly via the advisory lock.
const inFlightByTicket = new Map<number, Promise<GenerationResult>>();

export function enqueueInvoiceGenerationForTicket(ticketId: number): void {
  void runInvoiceGenerationCoalesced(ticketId).catch((err) => {
    logger.error({ err, ticketId }, "Invoice generation failed");
  });
}

export async function runInvoiceGenerationCoalesced(
  ticketId: number,
): Promise<GenerationResult> {
  const existing = inFlightByTicket.get(ticketId);
  if (existing) return existing;
  const p = generateInvoiceForTicket(ticketId)
    .then((result) => {
      if (result.ok) {
        logger.info(
          { ticketId, invoiceId: result.invoiceId, lines: result.lineCount, supplemental: result.supplemental },
          "Invoice generated for approved ticket",
        );
      } else {
        logger.warn({ ticketId, reason: result.reason }, "Invoice generation skipped");
      }
      return result;
    })
    .finally(() => {
      inFlightByTicket.delete(ticketId);
    });
  inFlightByTicket.set(ticketId, p);
  return p;
}

// ──────────────────────────────────────────────────────────────────
// Periodic close worker — flips draft→open at period boundary
// ──────────────────────────────────────────────────────────────────

let closeIntervalHandle: NodeJS.Timeout | null = null;

export function startInvoicePeriodWorker(intervalMs = 60 * 60 * 1000): void {
  if (closeIntervalHandle) return;
  // Run once immediately, then every intervalMs.
  void runOnce();
  closeIntervalHandle = setInterval(() => {
    void runOnce();
  }, intervalMs);
  logger.info({ intervalMs }, "Invoice period worker started");
}

export function stopInvoicePeriodWorker(): void {
  if (closeIntervalHandle) {
    clearInterval(closeIntervalHandle);
    closeIntervalHandle = null;
  }
}

async function runOnce(): Promise<void> {
  try {
    const now = new Date();
    // Find any draft invoices whose period_end has passed and flip them to
    // 'open' (ready for review/send). Sent/paid invoices are untouched.
    const result = await db
      .update(invoicesTable)
      .set({ status: "open" })
      .where(
        and(
          eq(invoicesTable.status, "draft"),
          sql`${invoicesTable.periodEnd} <= ${now}`,
        ),
      )
      .returning({ id: invoicesTable.id, cadence: invoicesTable.cadence });
    if (result.length > 0) {
      logger.info({ count: result.length }, "Closed expired invoice periods");
    }
  } catch (err) {
    logger.error({ err }, "Invoice period worker iteration failed");
  }
}

export type { Invoice };
