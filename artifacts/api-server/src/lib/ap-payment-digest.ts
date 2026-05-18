// Weekly Accounts Payable digest (Task #505).
//
// For every partner with at least one approved ticket whose
// payment_dispersed_at is still null and whose approvedAt is older
// than AP_DIGEST_THRESHOLD_DAYS, fan out a single email to every
// partner_contacts row tagged "Accounts Payable". The digest mirrors
// the dashboard tile + /tickets?awaitingPayment=true filtered list so
// AP staff get a weekly nudge for stuck disbursals.
//
// Idempotency: each (partner, ISO-week) pair is guarded by an entry in
// ap_payment_digest_log.dedupe_key UNIQUE. Every scheduler run inserts
// with ON CONFLICT DO NOTHING; the loser of any race silently skips.
// We only fan the email out after a successful insert so cross-instance
// racing is bounded to one in-flight digest per partner per week.
//
// We run the scan every 6 hours (matching the cadence of the invoice
// aging worker) but the dedupe_key carries the ISO-week label, so each
// partner still receives at most one digest per week regardless of how
// often the scan fires. Container restarts, deploys, or transient DB
// blips therefore cost at most ~6 hours of latency.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  sendAwaitingPaymentDigestEmail,
  type AwaitingPaymentDigestTicket,
} from "./sendgrid";
import { findPartnerApContactEmails } from "./ap-role";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_THRESHOLD_DAYS = 7;
const MAX_TICKETS_PER_DIGEST = 200;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// ISO-week label, e.g. "2026-W18". Used as the dedupe-key suffix so a
// partner cannot receive more than one digest in the same calendar
// week even if the worker runs multiple times.
export function isoWeekLabel(d: Date): string {
  // Algorithm: Thursday in current week decides the year of the ISO
  // week (per ISO-8601). See https://en.wikipedia.org/wiki/ISO_week_date.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // shift to Thursday in week
  const week1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diffDays =
    (target.getTime() - week1.getTime()) / (24 * 60 * 60 * 1000);
  const week1Dow = (week1.getUTCDay() + 6) % 7;
  const weekNum = 1 + Math.round((diffDays - 3 + week1Dow) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

interface PartnerDigestRow extends Record<string, unknown> {
  partner_id: number;
  partner_name: string;
  ticket_id: number;
  approved_at: string;
  total: string;
}

export interface ApPaymentDigestResult {
  scanned: number;
  digestsSent: number;
  digestsSkipped: number;
  errors: number;
}

export async function runApPaymentDigest(
  now: Date = new Date(),
): Promise<ApPaymentDigestResult> {
  const result: ApPaymentDigestResult = {
    scanned: 0,
    digestsSent: 0,
    digestsSkipped: 0,
    errors: 0,
  };
  const thresholdDays = envInt("AP_DIGEST_THRESHOLD_DAYS", DEFAULT_THRESHOLD_DAYS);
  const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);
  const weekLabel = isoWeekLabel(now);

  // One pass: pull every approved-not-dispersed ticket older than
  // cutoff with its partner + per-ticket extended total. We sort by
  // partner so the loop can group sequentially.
  const rows = await db.execute<PartnerDigestRow>(sql`
    select
      sl.partner_id          as partner_id,
      p.name                 as partner_name,
      t.id                   as ticket_id,
      to_char(t.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as approved_at,
      coalesce((
        select sum(li.quantity * li.unit_price)
        from ticket_line_items li
        where li.ticket_id = t.id
      ), 0)::numeric(14,2)::text as total
    from tickets t
    join site_locations sl on sl.id = t.site_location_id
    join partners p        on p.id = sl.partner_id
    where t.status = 'approved'
      and t.payment_dispersed_at is null
      and t.approved_at is not null
      and t.approved_at < ${cutoff}
    order by sl.partner_id, t.approved_at asc
  `);

  result.scanned = rows.rows?.length ?? 0;
  if (result.scanned === 0) return result;

  // Group rows by partner.
  const groups = new Map<
    number,
    { partnerName: string; tickets: PartnerDigestRow[] }
  >();
  for (const r of rows.rows!) {
    const g = groups.get(r.partner_id) ?? {
      partnerName: r.partner_name,
      tickets: [],
    };
    g.tickets.push(r);
    groups.set(r.partner_id, g);
  }

  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");

  for (const [partnerId, group] of groups.entries()) {
    const dedupeKey = `ap_digest:${partnerId}:${weekLabel}`;
    try {
      // INSERT first, side effects only on a successful claim. If we
      // lose the race the row already exists and we DO NOT email.
      const inserted = await db.execute<{ id: number }>(sql`
        insert into ap_payment_digest_log (partner_id, week_label, dedupe_key, sent_at, ticket_count)
        values (${partnerId}, ${weekLabel}, ${dedupeKey}, ${now}, ${group.tickets.length})
        on conflict (dedupe_key) do nothing
        returning id
      `);
      if ((inserted.rows?.length ?? 0) === 0) {
        result.digestsSkipped += 1;
        continue;
      }

      const recipients = await findPartnerApContactEmails(partnerId);
      if (recipients.length === 0) {
        // Mark the row so we don't re-attempt within this week.
        await db.execute(sql`
          update ap_payment_digest_log
             set failure_message = 'no_ap_contacts'
           where dedupe_key = ${dedupeKey}
        `);
        result.digestsSkipped += 1;
        continue;
      }

      // Build localized tickets payload. Currency formatting uses the
      // first recipient's locale as a coarse approximation; per-locale
      // batches inside sendgrid still re-render copy strings per locale
      // but the per-ticket date/amount text we precompute here is
      // shared across both batches to keep the helper simple.
      const primaryLocale = recipients[0]!.preferredLocale;
      const dateLocale = primaryLocale === "es" ? "es-MX" : "en-US";
      const fmtCurrency = (n: number) =>
        n.toLocaleString(dateLocale, { style: "currency", currency: "USD" });

      let totalUnits = 0;
      const tickets: AwaitingPaymentDigestTicket[] = group.tickets
        .slice(0, MAX_TICKETS_PER_DIGEST)
        .map((t) => {
          const approved = new Date(t.approved_at);
          const daysWaiting = Math.max(
            1,
            Math.floor((now.getTime() - approved.getTime()) / (24 * 60 * 60 * 1000)),
          );
          const amountNum = Number(t.total) || 0;
          totalUnits += amountNum;
          const trackingNumber = String(t.ticket_id).padStart(4, "0");
          const detailUrl = baseUrl
            ? `${baseUrl}/tickets/${t.ticket_id}`
            : `/tickets/${t.ticket_id}`;
          return {
            trackingNumber,
            approvedOnLabel: approved.toLocaleDateString(dateLocale),
            daysWaiting,
            amountLabel: fmtCurrency(amountNum),
            detailUrl,
          };
        });

      // Sum across the FULL group (not just the truncated visible
      // slice) so the partner sees the real waiting balance.
      const fullTotal = group.tickets.reduce(
        (acc, r) => acc + (Number(r.total) || 0),
        0,
      );
      void totalUnits;
      const queueUrl = baseUrl
        ? `${baseUrl}/tickets?awaitingPayment=true`
        : `/tickets?awaitingPayment=true`;

      try {
        await sendAwaitingPaymentDigestEmail({
          recipients: recipients.map((r) => ({
            email: r.email,
            locale: r.preferredLocale,
          })),
          partnerName: group.partnerName,
          thresholdDays,
          totalAmountLabel: fmtCurrency(fullTotal),
          queueUrl,
          tickets,
        });
        result.digestsSent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, partnerId }, "AP digest email failed");
        await db.execute(sql`
          update ap_payment_digest_log
             set failure_message = ${msg.slice(0, 240)}
           where dedupe_key = ${dedupeKey}
        `);
        result.errors += 1;
      }
    } catch (err) {
      logger.error({ err, partnerId }, "AP digest scan crashed for partner");
      result.errors += 1;
    }
  }

  return result;
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startApPaymentDigestWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) return;
  // Defer first run so boot doesn't pile additional work onto the
  // already-busy listening event handler.
  setTimeout(() => void runOnce("startup"), 90 * 1000);
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);
  logger.info({ intervalMs }, "AP payment digest worker started");
}

export function stopApPaymentDigestWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    const r = await runApPaymentDigest();
    if (r.scanned > 0 || r.digestsSent > 0) {
      logger.info(
        {
          trigger,
          ms: Date.now() - start,
          ...r,
        },
        "AP payment digest scan complete",
      );
    }
  } catch (err) {
    logger.error({ err, trigger }, "AP payment digest scan crashed");
  }
}
