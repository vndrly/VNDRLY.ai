import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

// Per-recipient 1099 filing-status row. The reports tab aggregates
// payments live; this table records the *external* state of each
// recipient's filing for a given tax year + form type:
//
//   - Has the recipient's copy been delivered (mailed or emailed)?
//   - Was the IRS submission queued / accepted / rejected?
//   - If e-filed via a partner (Track1099 etc.), what is their reference?
//
// The unique constraint (tax_year, form_type, payer_partner_id, recipient_vendor_id)
// guarantees one canonical row per filing combo so the dashboard can
// LEFT JOIN against aggregated rows without ambiguity.
export const TAX_1099_FORM_TYPES = ["NEC", "MISC", "K"] as const;
export type Tax1099FormType = (typeof TAX_1099_FORM_TYPES)[number];

export const TAX_1099_FILING_STATUSES = [
  "pending",
  "queued",
  "filed",
  "accepted",
  "rejected",
  "delivered",
  "error",
] as const;
export type Tax1099FilingStatus = (typeof TAX_1099_FILING_STATUSES)[number];

export const TAX_1099_FILING_METHODS = [
  "manual",
  "fire",
  "track1099",
  "tax1099",
  "other",
] as const;
export type Tax1099FilingMethod = (typeof TAX_1099_FILING_METHODS)[number];

// IRS Pub 1220 corrected-return indicator (B record position 6,
// A record position 7). When a previously-filed return needs to be
// corrected:
//   - "g" = one-step correction: amounts/codes/payee indicator wrong;
//           the corrected B record overwrites the original.
//   - "c" = two-step correction: TIN, name, or money was wrong AND the
//           identifier on the original was incorrect; per Pub 1220 the
//           corrected B is paired with a zero-amount B that backs out
//           the original. We currently emit only the corrected B and
//           leave the manual back-out to the operator (documented in
//           the dashboard tooltip).
//   - "none" (default) = original return.
// Storing the indicator lets the next FIRE export for this scope flip
// position 6 to "G" or "C" without anyone hand-editing the TXT.
export const TAX_1099_CORRECTION_STATUSES = ["none", "g", "c"] as const;
export type Tax1099CorrectionStatus =
  (typeof TAX_1099_CORRECTION_STATUSES)[number];

// Wire-level snapshot of the FIRE B-record payee identifiers + amounts
// captured at the moment a filing first transitions to a filed-like
// state. For Pub 1220 §F.5 two-step ("C") corrections, the IRS expects
// the corrected B record to be preceded by a zero-dollar B record that
// echoes the *original* payee identifiers being backed out. Without
// this snapshot the only remaining copy of those original identifiers
// is whatever the live aggregation queries produce today, which is
// already the *new* (corrected) data — so we cache the original here
// at filing time and replay it (with all amount fields zeroed) the
// next time we emit a FIRE export for this row.
export interface FirePayeeSnapshot {
  tin: string;
  tinType?: "1" | "2";
  nameControl?: string | null;
  name: string;
  name2?: string | null;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  accountNumber?: string | null;
  amounts: Record<string, string>;
  numberOfTransactions?: number;
  monthlyAmounts?: string[];
}

export const tax1099FilingsTable = pgTable(
  "tax_1099_filings",
  {
    id: serial("id").primaryKey(),
    taxYear: integer("tax_year").notNull(),
    formType: text("form_type").notNull(),
    payerPartnerId: integer("payer_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    recipientVendorId: integer("recipient_vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    // Snapshot of the aggregated reportable amount at the time the row was
    // last touched. Useful for the dashboard so the UI doesn't have to
    // re-aggregate from scratch on every render. Sources of truth remain
    // the underlying invoice_payments / invoice_lines tables; this is a
    // cache.
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("pending"),
    filingMethod: text("filing_method").notNull().default("manual"),
    // Pub 1220 corrected-return indicator. See TAX_1099_CORRECTION_STATUSES.
    correctedStatus: text("corrected_status").notNull().default("none"),
    // Wire-level snapshot of the original payee B-record fields,
    // captured the first time this filing transitions to a filed-like
    // state. Used to emit the zero-dollar back-out B record that Pub
    // 1220 §F.5 two-step ("C") corrections require to precede the
    // corrected B record. Null for rows that were never filed (or for
    // legacy rows filed before this column existed).
    originalPayeeSnapshot: jsonb("original_payee_snapshot").$type<
      FirePayeeSnapshot | null
    >(),
    // External submission reference (FIRE batch ID, Track1099 form id, etc.).
    externalReference: text("external_reference"),
    // When the IRS submission was acknowledged (or marked filed manually).
    filedAt: timestamp("filed_at", { withTimezone: true }),
    // When the recipient copy left our system (email send or marked mailed).
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryChannel: text("delivery_channel"), // 'email' | 'mail' | null
    notes: text("notes"),
    // SendGrid event-webhook tracking. When the recipient copy is emailed,
    // we capture SendGrid's `x-message-id` so the webhook handler can map
    // an inbound event ('delivered', 'open', 'bounce', 'dropped',
    // 'spamreport', etc.) back to this filing row. Custom args attached
    // to the send (year/formType/payerPartnerId/recipientVendorId) act
    // as a fallback lookup if the message id isn't available.
    sendgridMessageId: text("sendgrid_message_id"),
    // Most recent inbound webhook event (e.g. 'delivered', 'open',
    // 'bounce', 'dropped', 'deferred', 'spamreport') and when it arrived.
    lastEventType: text("last_event_type"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    // Bounce/drop reason verbatim from SendGrid (`reason` field on the
    // event payload), surfaced in the dashboard so admins/partners can
    // tell whether the recipient mailbox is bad, the message was filtered,
    // etc.
    bounceReason: text("bounce_reason"),
    // First time SendGrid reported an `open` event for this message.
    // Distinct from `lastEventAt` so re-opens don't overwrite the original
    // proof-of-receipt timestamp the IRS-consent audit relies on.
    openedAt: timestamp("opened_at", { withTimezone: true }),
    updatedByUserId: integer("updated_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqFiling: uniqueIndex("tax_1099_filings_unique").on(
      t.taxYear,
      t.formType,
      t.payerPartnerId,
      t.recipientVendorId,
    ),
    idxYear: index("tax_1099_filings_year_idx").on(t.taxYear, t.formType),
    idxPayer: index("tax_1099_filings_payer_idx").on(
      t.payerPartnerId,
      t.taxYear,
    ),
    // Hot path for the SendGrid event webhook: an inbound event arrives
    // tagged with `sg_message_id` (whose prefix matches the `x-message-id`
    // we stored at send time), and the handler needs to look up the
    // corresponding filing row in O(log n).
    idxSendgridMsg: index("tax_1099_filings_sendgrid_msg_idx").on(
      t.sendgridMessageId,
    ),
  }),
);

export const insertTax1099FilingSchema = createInsertSchema(
  tax1099FilingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTax1099Filing = z.infer<typeof insertTax1099FilingSchema>;
export type Tax1099Filing = typeof tax1099FilingsTable.$inferSelect;
