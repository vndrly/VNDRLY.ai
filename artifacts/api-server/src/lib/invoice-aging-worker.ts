// Daily aging worker. Scans invoices in (open|sent|overdue) with balance > 0
// and:
//   - flips status to 'overdue' when due_date < today
//   - emits dedupe-protected reminders at 1 / 15 / 30 days past due
//
// Idempotency: each (invoice, threshold) reminder is guarded by
// invoice_reminder_log.dedupe_key UNIQUE. Workers re-running the same window
// (whether on the same instance after a restart, or on a replicated
// instance) will skip already-fired thresholds via ON CONFLICT DO NOTHING.
//
// Cross-instance gating: the scheduled scan acquires a SESSION-scoped
// Postgres advisory lock (`pg_try_advisory_lock`) on a dedicated pool
// client before doing any work. If the lock cannot be acquired, another
// API instance is currently scanning, so we log and return — failure to
// acquire is NOT an error. The dedupe-key UNIQUE on
// `invoice_reminder_log` stays in place as a backstop for any path that
// bypasses the lock (e.g. `runInvoiceAgingScan` invoked directly from
// tests or an admin tool). See `runInvoiceAgingScanWithLock` below.

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  invoiceReminderLogTable,
  pool,
  vendorsTable,
  partnersTable,
  vendorPartnerBillingSettingsTable,
  type LateFeeRule,
} from "@workspace/db";
import { logger } from "./logger";
import { sendInvoiceReminderEmail } from "./sendgrid";
import { mulUnits, toFixedUnits, totalLines, unitsToString2 } from "./invoice-engine";
import {
  findPartnerBillingUserIds,
  findVendorUserIds,
  resolveBillingEmail,
  resolveBillingLocale,
} from "./invoice-recipients";
import { notifyUsers } from "../routes/notifications";

// Cadence note: the spec calls for a "daily" worker. We schedule the
// scan every 6 hours intentionally — running 4× per day means a
// container restart, deploy, or transient DB blip can cost at most ~6
// hours of latency on a threshold notification instead of nearly a full
// day. Idempotency is preserved across all of those runs by the unique
// dedupe_key on invoice_reminder_log (`aging:${threshold}d:${invoiceId}`),
// so the recipient still sees exactly one notification + email per
// (invoice, threshold) pair regardless of how often we scan.
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FALLBACK_THRESHOLDS_DAYS = [1, 15, 30] as const;
const MAX_THRESHOLD_DAYS = 365;

// Postgres advisory-lock keys for the cross-instance scan gate. The
// two-int form `pg_try_advisory_lock(int4, int4)` is keyed by
// (namespace, key) so we don't collide with other advisory locks the
// system may use. The namespace is intentionally distinct from
// invoice-generator's (0x1949c01) and any other future lock — never
// change it without migrating every replica, otherwise an old replica
// using the old constant would NOT block against a new replica using
// the new one. The key is `1` because there is exactly one global
// scan; per-invoice serialization is handled separately by the
// reminder-log unique index.
const ADVISORY_LOCK_NS_INVOICE_AGING = 0x1949c02;
const ADVISORY_LOCK_KEY_INVOICE_AGING = 1;

// Sanitize an arbitrary jsonb value into a sorted, dedup'd, positive-int
// list of thresholds. Falls back to system default when the column is
// missing, malformed, or empty.
// Calendar-day diff (UTC). Truncates both sides to UTC midnight before
// subtracting so a due date and "now" that fall on the same calendar
// day always read as 0 days past due regardless of time-of-day or DST
// transition. Exported so the API route + tests share one definition.
export function calcDaysPastDueUTC(due: Date, now: Date): number {
  const dueDay = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );
  const nowDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((nowDay - dueDay) / (24 * 60 * 60 * 1000));
}

function normalizeThresholds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...FALLBACK_THRESHOLDS_DAYS];
  const cleaned = raw
    .map((v) => (typeof v === "number" ? Math.floor(v) : NaN))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_THRESHOLD_DAYS);
  if (cleaned.length === 0) return [...FALLBACK_THRESHOLDS_DAYS];
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startInvoiceAgingWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) return;
  void runOnce("startup");
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info({ intervalMs }, "Invoice aging worker started");
}

export function stopInvoiceAgingWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

interface AgingScanResult {
  scanned: number;
  flippedToOverdue: number;
  remindersFired: number;
  reminderFailures: number;
}

// Exported for tests.
export async function runInvoiceAgingScan(
  now: Date = new Date(),
): Promise<AgingScanResult> {
  const result: AgingScanResult = {
    scanned: 0,
    flippedToOverdue: 0,
    remindersFired: 0,
    reminderFailures: 0,
  };

  // Pull all candidates in one query: open / sent / overdue with balance > 0
  // and a due_date strictly before TODAY's UTC midnight. We deliberately
  // compare against the start of *today* (not `now`) so that an invoice
  // whose due_date falls within the current UTC calendar day is NOT yet
  // considered overdue — matches the day-based semantics enforced by
  // calcDaysPastDueUTC and the customer-visible "X days past due" copy.
  const todayUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        inArray(invoicesTable.status, ["open", "sent", "overdue"]),
        isNotNull(invoicesTable.dueDate),
        lt(invoicesTable.dueDate, todayUtcMidnight),
        sql`(${invoicesTable.total}::numeric - ${invoicesTable.paidAmount}::numeric - ${invoicesTable.creditedAmount}::numeric) > 0`,
      ),
    );

  result.scanned = rows.length;

  for (const inv of rows) {
    if (!inv.dueDate) continue;
    const balanceU =
      toFixedUnits(inv.total) -
      toFixedUnits(inv.paidAmount) -
      toFixedUnits(inv.creditedAmount);
    if (balanceU <= 0n) continue;

    const daysPastDue = calcDaysPastDueUTC(new Date(inv.dueDate), now);
    // Belt-and-suspenders gate: only progress past this point when the
    // invoice is at least one full UTC calendar day past due. The SQL
    // predicate above already filters to due_date < today_midnight, but
    // this guard keeps the in-memory branch self-consistent with the
    // helper and protects against time-zone drift in the DB driver.
    if (daysPastDue <= 0) continue;

    // 1) Flip to overdue if not already.
    if (inv.status !== "overdue") {
      await db
        .update(invoicesTable)
        .set({ status: "overdue" })
        .where(eq(invoicesTable.id, inv.id));
      result.flippedToOverdue += 1;
    }

    // 1b) Apply admin-configured late fee, once per invoice. Effective
    // rule = per-invoice override (`invoices.late_fee_rule`, captured at
    // generation time or set later via PATCH /invoices/:id/late-fee-rule)
    // ELSE the per-(vendor, partner) default in
    // `vendor_partner_billing_settings.late_fee_rule`. The aging scan
    // runs every 6 hours (or on demand); the existence check on the
    // late-fee row makes a re-scan a no-op so we never double-charge a
    // vendor for a transient worker restart, lock contention, or admin
    // running the scan manually.
    //
    // Idempotency contract:
    //  - At most ONE invoice line per invoice with sourceType="late_fee"
    //    (no DB unique index — `is_manual_override=true` keeps it out of
    //    the `uniqGeneratedDedupe*` partial indexes — instead we read
    //    before insert under the worker's advisory lock; concurrent
    //    inserts via other paths are not possible because the only
    //    writer of late-fee lines is this code path).
    //  - `is_manual_override=true` and `ticket_id=null` so a future
    //    invoice regenerate (which only touches generated, non-manual
    //    lines linked to a ticket) will never wipe the fee.
    //
    // Math:
    //  - flat:    amount = rule.amount (already a 2-dp string)
    //  - percent: amount = invoice.total * rule.rate / 100, rounded
    //             half-away-from-zero to 2 dp (`unitsToString2`).
    //             Computed off the *current* invoice.total — i.e. the
    //             total before the late fee — because the rule is
    //             "X% of the overdue invoice", not a compounding fee.
    //  - none:    skip.
    await maybeApplyLateFee(inv, daysPastDue);

    // 2) Per-vendor thresholds. Read vendor.aging_threshold_days; fall back
    // to the system default when the column is missing or malformed.
    const [vendorRow] = await db
      .select({ thresholds: vendorsTable.agingThresholdDays })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, inv.vendorId));
    const thresholds = normalizeThresholds(vendorRow?.thresholds);

    // For each threshold ≤ daysPastDue, attempt to record + fire reminder.
    for (const threshold of thresholds) {
      if (daysPastDue < threshold) continue;
      const dedupeKey = `aging:${threshold}d:${inv.id}`;

      // ON CONFLICT DO NOTHING. If we lose the race, this returns no rows
      // and we do NOT send the email or notify (another instance handled it).
      // Retry semantics: if a prior attempt for this (invoice, threshold)
      // recorded a failureMessage (transient SendGrid 5xx, no_recipient,
      // etc.), we treat it as not-yet-delivered and re-attempt the side
      // effects. The dedupe row stays in place so cross-instance racing
      // is still bounded to one in-flight attempt at a time. A successful
      // delivery clears failureMessage and locks future runs out.
      const inserted = await db
        .insert(invoiceReminderLogTable)
        .values({
          invoiceId: inv.id,
          kind: "aging",
          threshold: `${threshold}d`,
          dedupeKey,
          sentAt: now,
        })
        .onConflictDoNothing({
          target: invoiceReminderLogTable.dedupeKey,
        })
        .returning({ id: invoiceReminderLogTable.id });

      if (inserted.length === 0) {
        const [existing] = await db
          .select({
            id: invoiceReminderLogTable.id,
            failureMessage: invoiceReminderLogTable.failureMessage,
          })
          .from(invoiceReminderLogTable)
          .where(eq(invoiceReminderLogTable.dedupeKey, dedupeKey));
        if (!existing || !existing.failureMessage) continue; // already delivered
        // Terminal-failure short-circuit. `no_recipient_email` only clears
        // when somebody actually wires a billing contact to the partner +
        // re-sends the invoice (which caches the address on
        // invoices.billing_contact_email). Until that happens, retrying
        // every scan just re-issues the same DB writes and log lines.
        // Skip until the cached billing email changes; subsequent scans
        // remain idempotent and a real human action unblocks delivery.
        if (
          existing.failureMessage === "no_recipient_email" &&
          !inv.billingContactEmail
        ) {
          continue;
        }
        // else fall through and retry the side effects below.
      }

      // Best-effort email + in-app notify.
      try {
        const [vendor] = await db
          .select()
          .from(vendorsTable)
          .where(eq(vendorsTable.id, inv.vendorId));
        const [partner] = await db
          .select()
          .from(partnersTable)
          .where(eq(partnersTable.id, inv.partnerId));

        const toEmail = await resolveBillingEmail({
          override: null,
          cachedBillingEmail: inv.billingContactEmail,
          partnerId: inv.partnerId,
        });
        const locale = await resolveBillingLocale({
          email: toEmail,
          partnerId: inv.partnerId,
        });

        const balDue = unitsToString2(balanceU);
        const balDueUSD = Number(balDue).toLocaleString(
          locale === "es" ? "es-MX" : "en-US",
          { style: "currency", currency: "USD" },
        );

        let emailFailure: string | null = null;
        if (toEmail && vendor && partner) {
          try {
            await sendInvoiceReminderEmail({
              to: toEmail,
              vendorName: vendor.name,
              partnerName: partner.name,
              invoiceNumber: inv.invoiceNumber,
              balanceDue: balDueUSD,
              dueDate: inv.dueDate.toLocaleDateString(
                locale === "es" ? "es-MX" : "en-US",
              ),
              daysPastDue: threshold,
              reminderKind: "aging",
              locale,
            });
          } catch (err) {
            emailFailure = err instanceof Error ? err.message : String(err);
            logger.warn(
              { err, invoiceId: inv.id, threshold },
              "Aging reminder email failed",
            );
            result.reminderFailures += 1;
          }
        } else if (!toEmail) {
          emailFailure = "no_recipient_email";
        }

        if (emailFailure) {
          await db
            .update(invoiceReminderLogTable)
            .set({
              failureMessage: emailFailure,
              sentToEmail: toEmail,
            })
            .where(eq(invoiceReminderLogTable.dedupeKey, dedupeKey));
        } else if (toEmail) {
          // Clear failureMessage so we don't keep retrying once delivered.
          await db
            .update(invoiceReminderLogTable)
            .set({ sentToEmail: toEmail, failureMessage: null })
            .where(eq(invoiceReminderLogTable.dedupeKey, dedupeKey));
        }

        // In-app notify both sides. notifyUsers handles user-preference opt-outs.
        const partnerUsers = await findPartnerBillingUserIds(inv.partnerId);
        const vendorUsers = await findVendorUserIds(inv.vendorId);
        const title = `Invoice ${inv.invoiceNumber} is ${threshold} day${threshold === 1 ? "" : "s"} past due`;
        const body = `Balance ${balDueUSD} on invoice ${inv.invoiceNumber}.`;
        await notifyUsers(partnerUsers, {
          type: "invoice_aging",
          title,
          body,
          link: `/invoices/${inv.id}`,
          category: "system",
          dedupeKey: `${dedupeKey}:partner`,
        });
        await notifyUsers(vendorUsers, {
          type: "invoice_aging",
          title,
          body,
          link: `/invoices/${inv.id}`,
          category: "system",
          dedupeKey: `${dedupeKey}:vendor`,
        });

        result.remindersFired += 1;
      } catch (err) {
        // Don't unwind: a side-effect failure for one invoice shouldn't
        // block aging for the rest.
        logger.error(
          { err, invoiceId: inv.id, threshold },
          "Aging reminder side-effects failed",
        );
        result.reminderFailures += 1;
      }
    }
  }

  return result;
}

/**
 * Cross-instance gated wrapper around `runInvoiceAgingScan`. Acquires a
 * SESSION-scoped Postgres advisory lock on a dedicated pool client; if
 * the lock is held by another API instance, the scan is skipped (logged
 * at info, not an error). The lock is always released — both on success
 * and on a thrown scan — and the underlying client returned to the pool.
 *
 * Returns the scan result on success, or `null` when the lock was not
 * acquired. Exposed for tests; the scheduler invokes it via `runOnce`.
 */
export async function runInvoiceAgingScanWithLock(
  now: Date = new Date(),
): Promise<AgingScanResult | null> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lockRes = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
      [ADVISORY_LOCK_NS_INVOICE_AGING, ADVISORY_LOCK_KEY_INVOICE_AGING],
    );
    acquired = lockRes.rows[0]?.acquired === true;
    if (!acquired) {
      // Another API instance is currently scanning. Not an error — the
      // other instance will handle this interval; we'll re-attempt at
      // the next tick. Logged so operators can see the gate working.
      logger.info(
        {
          ns: ADVISORY_LOCK_NS_INVOICE_AGING,
          key: ADVISORY_LOCK_KEY_INVOICE_AGING,
        },
        "Invoice aging scan skipped: advisory lock held by another instance",
      );
      return null;
    }
    return await runInvoiceAgingScan(now);
  } finally {
    if (acquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock($1::int, $2::int)",
          [ADVISORY_LOCK_NS_INVOICE_AGING, ADVISORY_LOCK_KEY_INVOICE_AGING],
        );
      } catch (err) {
        // Best-effort: a failed unlock isn't fatal because the lock is
        // session-scoped and will be released when the client is
        // returned to the pool and ultimately closed. Log so operators
        // notice if it starts happening regularly.
        logger.warn(
          { err },
          "Invoice aging scan: failed to release advisory lock",
        );
      }
    }
    client.release();
  }
}

// Resolve and apply (idempotently) the late-fee rule for one invoice.
// Reads the per-invoice override first; if NULL, falls back to the
// per-(vendor, partner) billing-settings default. No-ops when:
//  - effective rule is null or {kind:"none"}
//  - daysPastDue < rule.afterDays
//  - a late-fee line (sourceType="late_fee") already exists on the invoice
//  - computed fee rounds to "0.00" (e.g. percent rule on a $0 invoice)
//
// On insert, recomputes invoice subtotal/taxTotal/total from ALL lines
// and updates `lastRecomputedAt`. The fee line is taxable=false and
// taxRate=null because late fees are typically not taxable services in
// US oilfield billing. Admins who need taxable late fees can edit the
// generated row in place via the existing line editor (the
// is_manual_override=true flag already present means the regenerate path
// will not overwrite their edit).
//
// Exported for the aging-worker test which exercises the late-fee
// branch in isolation against a real Postgres.
export async function maybeApplyLateFee(
  inv: typeof invoicesTable.$inferSelect,
  daysPastDue: number,
): Promise<void> {
  // Resolve effective rule. Per-invoice override wins over the vendor
  // default; only fall back to billing settings when the override is
  // strictly null (an explicit {kind:"none"} stops here and skips).
  let rule: LateFeeRule | null = inv.lateFeeRule ?? null;
  if (rule === null) {
    const [billingRow] = await db
      .select({ lateFeeRule: vendorPartnerBillingSettingsTable.lateFeeRule })
      .from(vendorPartnerBillingSettingsTable)
      .where(
        and(
          eq(vendorPartnerBillingSettingsTable.vendorId, inv.vendorId),
          eq(vendorPartnerBillingSettingsTable.partnerId, inv.partnerId),
        ),
      );
    rule = billingRow?.lateFeeRule ?? null;
  }
  if (!rule || rule.kind === "none") return;
  if (daysPastDue < rule.afterDays) return;

  // Existence check — if any late-fee line already exists on this
  // invoice, the fee has been applied and we never re-apply. Reading
  // count() under the worker's advisory lock is sufficient because the
  // aging worker is the sole writer of late-fee lines and runs inside
  // the cluster-wide `runInvoiceAgingScanWithLock` gate.
  const existing = await db
    .select({ id: invoiceLinesTable.id })
    .from(invoiceLinesTable)
    .where(
      and(
        eq(invoiceLinesTable.invoiceId, inv.id),
        eq(invoiceLinesTable.sourceType, "late_fee"),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  // Compute fee amount. Flat rules pre-store a 2-dp string (validated
  // by the zod schema before write); percent rules compute against the
  // current invoice.total (pre-fee) and round half-away-from-zero via
  // unitsToString2 to keep ledger arithmetic on whole cents.
  let amount: string;
  if (rule.kind === "flat") {
    // Normalize through unitsToString2 so a "5" or "5.5" stored value
    // round-trips to "5.00" / "5.50" — keeps the column's numeric(14,2)
    // happy on insert and matches what the line.amount column displays.
    amount = unitsToString2(toFixedUnits(rule.amount));
  } else {
    // Percent rate is stored as e.g. "1.50" meaning 1.50%. Divide by
    // 100 by scaling the rate fixed-units down by SCALE * 100. We do
    // it via mulUnits then integer-divide by 100 to keep all math in
    // bigint and avoid float drift.
    const totalU = toFixedUnits(inv.total);
    const rateU = toFixedUnits(rule.rate);
    const grossU = mulUnits(totalU, rateU); // = total * rate (still in SCALE)
    const feeU = grossU / 100n;
    amount = unitsToString2(feeU);
  }
  // Skip zero-cent fees so we don't pollute the line list (e.g. percent
  // rule on an invoice that hit overdue but has $0 net — possible on a
  // fully-credited overdue invoice that the SQL filter already keeps
  // out, but defensive).
  if (toFixedUnits(amount) === 0n) return;

  const description =
    rule.kind === "flat"
      ? `Late fee — ${daysPastDue} day${daysPastDue === 1 ? "" : "s"} past due`
      : `Late fee (${rule.rate}%) — ${daysPastDue} day${daysPastDue === 1 ? "" : "s"} past due`;

  // Compute next sortOrder so the late-fee line lands at the bottom of
  // the invoice (after all generated/manual lines). Using max+1 instead
  // of a fixed large number lets admins still reorder lines after the
  // fact without colliding with the late fee.
  const [maxRow] = await db
    .select({
      max: sql<number>`COALESCE(MAX(${invoiceLinesTable.sortOrder}), 0)::int`,
    })
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, inv.id));
  const nextSort = (maxRow?.max ?? 0) + 1;

  await db.insert(invoiceLinesTable).values({
    invoiceId: inv.id,
    ticketId: null,
    sourceType: "late_fee",
    sourceId: null,
    afe: null,
    lineType: "other",
    description,
    quantity: "1",
    unit: null,
    unitPrice: amount,
    amount,
    taxable: false,
    taxState: null,
    taxRate: null,
    taxAmount: "0",
    isManualOverride: true,
    sortOrder: nextSort,
    incomeCategory: "none",
  });

  // Recompute invoice totals from ALL lines (including the new late fee).
  const allLines = await db
    .select({
      amount: invoiceLinesTable.amount,
      taxAmount: invoiceLinesTable.taxAmount,
    })
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, inv.id));
  const totals = totalLines(allLines);
  await db
    .update(invoicesTable)
    .set({
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      lastRecomputedAt: new Date(),
    })
    .where(eq(invoicesTable.id, inv.id));

  logger.info(
    {
      invoiceId: inv.id,
      vendorId: inv.vendorId,
      partnerId: inv.partnerId,
      daysPastDue,
      ruleKind: rule.kind,
      amount,
      newTotal: totals.total,
    },
    "Late fee applied",
  );
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runInvoiceAgingScanWithLock();
    if (r === null) {
      logger.info(
        { trigger, ms: Date.now() - start },
        "Invoice aging scan skipped (lock not acquired)",
      );
      return;
    }
    logger.info(
      {
        trigger,
        ms: Date.now() - start,
        ...r,
      },
      "Invoice aging scan complete",
    );
  } catch (err) {
    logger.error({ err, trigger }, "Invoice aging scan crashed");
  }
}
