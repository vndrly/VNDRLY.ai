// SendGrid event webhook receiver.
//
// SendGrid POSTs an array of event objects to this endpoint each time
// our outbound mail is delivered, opened, bounced, dropped, deferred,
// or marked as spam. The handler maps each event back to the originating
// `tax_1099_filings` row and updates the per-row delivery status so the
// 1099 dashboard surfaces the real post-send outcome (not just the API
// accept that the deliver flow records).
//
// Lookup strategy (per event):
//   1. Match by the `tax1099_*` custom_args we attach at send time
//      (year, formType, payerPartnerId, recipientVendorId). These are
//      echoed back on every event for the message and uniquely identify
//      the filing row.
//   2. Fall back to looking up by `sg_message_id`'s prefix against the
//      `sendgrid_message_id` column we stored when the API send returned.
//      This is a defensive backstop for events where, for whatever
//      reason, custom_args are missing.
//
// Status policy:
//   - `delivered`     → status='delivered' (already set by the deliver
//                       flow on API accept; we refresh deliveredAt and
//                       record the lastEvent so admins can see the
//                       confirmation timestamp)
//   - `open`          → openedAt set to first-open timestamp (re-opens
//                       only update lastEventAt); status untouched
//   - `bounce` |
//     `dropped` |
//     `spamreport`    → status='error', bounceReason captured from the
//                       event's `reason`/`response` field, and the
//                       reason summarized in `notes` so the dashboard's
//                       existing notes column shows the failure
//   - other           → recorded as lastEventType/lastEventAt, no status
//                       transition
//
// Auth: SendGrid does not include a session cookie. Operators may set
// `SENDGRID_WEBHOOK_VERIFICATION_TOKEN` to a random secret and configure
// SendGrid to send it as the `X-Webhook-Token` header (or `?token=…`
// query param). When set, requests without a matching token are rejected
// with 401. When unset, the endpoint logs a warning on every request so
// operators don't forget to harden it before going live.

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  tax1099FilingsTable,
  TAX_1099_FORM_TYPES,
  type Tax1099FormType,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Subset of SendGrid event-webhook payload fields we care about. SendGrid
// adds many more (sg_event_id, ip, useragent, …) but the handler only
// needs the type + identifiers + the bounce/drop reason.
interface SendGridEvent {
  event?: string;
  email?: string;
  timestamp?: number;
  reason?: string;
  response?: string;
  type?: string; // e.g. 'bounce'/'blocked' on bounce events
  sg_message_id?: string;
  // Custom args tunneled through from send1099RecipientEmail. SendGrid
  // echoes any string keys we passed in `customArgs` back on every event
  // for the message.
  tax1099_year?: string;
  tax1099_form_type?: string;
  tax1099_payer_partner_id?: string;
  tax1099_recipient_vendor_id?: string;
  [k: string]: unknown;
}

const TERMINAL_FAILURE_EVENTS = new Set([
  "bounce",
  "dropped",
  "spamreport",
  "blocked",
]);

function checkAuth(req: Request, res: Response): boolean {
  const expected = process.env.SENDGRID_WEBHOOK_VERIFICATION_TOKEN;
  if (!expected) {
    // Fail closed: a webhook that mutates compliance-sensitive
    // tax_1099_filings rows must not be reachable without an
    // operator-configured shared secret. Operators that genuinely
    // need an unauthenticated endpoint (e.g. for local development
    // against a SendGrid sandbox) can opt in by setting
    // SENDGRID_WEBHOOK_ALLOW_UNAUTH=1 — this is intentionally noisy
    // in the logs so it cannot be accidentally left on in prod.
    if (process.env.SENDGRID_WEBHOOK_ALLOW_UNAUTH === "1") {
      logger.warn(
        "SendGrid webhook running without verification token (SENDGRID_WEBHOOK_ALLOW_UNAUTH=1)",
      );
      return true;
    }
    logger.error(
      "SendGrid webhook rejected: SENDGRID_WEBHOOK_VERIFICATION_TOKEN is not set",
    );
    res.status(503).json({ error: "Webhook receiver not configured" });
    return false;
  }
  const headerVal = req.header("x-webhook-token");
  const queryVal =
    typeof req.query.token === "string" ? req.query.token : undefined;
  const provided = headerVal ?? queryVal;
  if (provided && provided === expected) return true;
  res.status(401).json({ error: "Invalid webhook token" });
  return false;
}

function parseCustomArgs(ev: SendGridEvent): {
  taxYear: number;
  formType: Tax1099FormType;
  payerPartnerId: number;
  recipientVendorId: number;
} | null {
  const yearStr = ev.tax1099_year;
  const formStr = ev.tax1099_form_type;
  const payerStr = ev.tax1099_payer_partner_id;
  const vendorStr = ev.tax1099_recipient_vendor_id;
  if (!yearStr || !formStr || !payerStr || !vendorStr) return null;
  const year = Number(yearStr);
  const payer = Number(payerStr);
  const vendor = Number(vendorStr);
  if (!Number.isInteger(year) || !Number.isInteger(payer) || !Number.isInteger(vendor)) {
    return null;
  }
  if (!(TAX_1099_FORM_TYPES as readonly string[]).includes(formStr)) return null;
  return {
    taxYear: year,
    formType: formStr as Tax1099FormType,
    payerPartnerId: payer,
    recipientVendorId: vendor,
  };
}

// SendGrid's `sg_message_id` arrives shaped like `<x-message-id>.filterdrecv-...`.
// Our stored `sendgrid_message_id` is the bare `x-message-id`, so split on
// the first `.` to get a comparable lookup key.
function normalizeSgMessageId(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  return dot === -1 ? raw : raw.slice(0, dot);
}

async function findFilingId(ev: SendGridEvent): Promise<number | null> {
  const args = parseCustomArgs(ev);
  if (args) {
    const rows = await db
      .select({ id: tax1099FilingsTable.id })
      .from(tax1099FilingsTable)
      .where(
        and(
          eq(tax1099FilingsTable.taxYear, args.taxYear),
          eq(tax1099FilingsTable.formType, args.formType),
          eq(tax1099FilingsTable.payerPartnerId, args.payerPartnerId),
          eq(tax1099FilingsTable.recipientVendorId, args.recipientVendorId),
        ),
      )
      .limit(1);
    if (rows.length > 0) return rows[0].id;
  }
  const msgId = normalizeSgMessageId(ev.sg_message_id);
  if (msgId) {
    const rows = await db
      .select({ id: tax1099FilingsTable.id })
      .from(tax1099FilingsTable)
      .where(eq(tax1099FilingsTable.sendgridMessageId, msgId))
      .limit(1);
    if (rows.length > 0) return rows[0].id;
  }
  return null;
}

interface ApplyResult {
  matched: number;
  unknown: number;
  ignored: number;
}

async function applyEvent(
  ev: SendGridEvent,
  result: ApplyResult,
): Promise<void> {
  const eventType = (ev.event ?? "").toLowerCase();
  if (!eventType) {
    result.ignored++;
    return;
  }
  const filingId = await findFilingId(ev);
  if (!filingId) {
    result.unknown++;
    return;
  }
  const eventAt = ev.timestamp
    ? new Date(ev.timestamp * 1000)
    : new Date();
  const reason =
    typeof ev.reason === "string" && ev.reason.trim().length > 0
      ? ev.reason
      : typeof ev.response === "string" && ev.response.trim().length > 0
        ? ev.response
        : null;

  const patch: Record<string, unknown> = {
    lastEventType: eventType,
    lastEventAt: eventAt,
    updatedAt: new Date(),
  };

  if (eventType === "delivered") {
    patch.deliveredAt = eventAt;
    patch.deliveryChannel = "email";
    // Don't downgrade a row that's already further along the lifecycle
    // (filed/accepted) — only flip back to 'delivered' if it was an
    // earlier state like pending/queued/error.
    const [existing] = await db
      .select({ status: tax1099FilingsTable.status })
      .from(tax1099FilingsTable)
      .where(eq(tax1099FilingsTable.id, filingId))
      .limit(1);
    if (
      existing &&
      (existing.status === "pending" ||
        existing.status === "queued" ||
        existing.status === "error")
    ) {
      patch.status = "delivered";
    }
  } else if (eventType === "open") {
    // Only set openedAt the *first* time so re-opens don't overwrite
    // the original proof-of-receipt timestamp.
    const [existing] = await db
      .select({ openedAt: tax1099FilingsTable.openedAt })
      .from(tax1099FilingsTable)
      .where(eq(tax1099FilingsTable.id, filingId))
      .limit(1);
    if (existing && !existing.openedAt) {
      patch.openedAt = eventAt;
    }
  } else if (TERMINAL_FAILURE_EVENTS.has(eventType)) {
    patch.status = "error";
    patch.bounceReason = reason ?? eventType;
    patch.notes = `SendGrid ${eventType}${reason ? `: ${reason}` : ""}`.slice(
      0,
      1900,
    );
  }

  await db
    .update(tax1099FilingsTable)
    .set(patch)
    .where(eq(tax1099FilingsTable.id, filingId));
  result.matched++;
}

// POST /api/webhooks/sendgrid — accepts an array of SendGrid event
// objects. Always returns 200 once the body is parsed (even if some
// events couldn't be matched) so SendGrid doesn't retry the entire
// batch on a single unknown id; per-event outcomes are reported in
// the response body and the server log for operator follow-up.
router.post("/webhooks/sendgrid", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;
  const body = req.body;
  if (!Array.isArray(body)) {
    res.status(400).json({ error: "Body must be an array of events" });
    return;
  }
  const result: ApplyResult = { matched: 0, unknown: 0, ignored: 0 };
  for (const raw of body) {
    if (!raw || typeof raw !== "object") {
      result.ignored++;
      continue;
    }
    try {
      await applyEvent(raw as SendGridEvent, result);
    } catch (err) {
      logger.error({ err, event: raw }, "SendGrid event handler failed");
      result.ignored++;
    }
  }
  // Bulk-mark any unrelated message_ids the webhook drove us toward — no
  // action needed beyond logging.
  if (result.unknown > 0) {
    logger.info(
      { unknown: result.unknown, total: body.length },
      "SendGrid webhook events for unknown messages",
    );
  }
  res.json(result);
});

export default router;
