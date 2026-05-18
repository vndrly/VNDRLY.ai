import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

// Task #505 — weekly Accounts Payable digest dedupe log.
//
// One row per (partner, ISO week) digest send. The unique
// `dedupe_key` (`ap_digest:<partnerId>:<isoWeek>`) bounds cross-instance
// races to a single delivery — losers ON CONFLICT DO NOTHING and skip
// the email side effect. `failure_message` records terminal-skip
// reasons (e.g. `no_ap_contacts`) so operators can see why a partner
// was skipped without re-running the worker.
export const apPaymentDigestLogTable = pgTable(
  "ap_payment_digest_log",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "cascade" }),
    weekLabel: text("week_label").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ticketCount: integer("ticket_count").notNull().default(0),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxPartner: index("ap_payment_digest_log_partner_idx").on(t.partnerId),
    uniqDedupe: uniqueIndex("ap_payment_digest_log_dedupe_unique").on(
      t.dedupeKey,
    ),
  }),
);

export const insertApPaymentDigestLogSchema = createInsertSchema(
  apPaymentDigestLogTable,
).omit({ id: true });
export type InsertApPaymentDigestLog = z.infer<
  typeof insertApPaymentDigestLogSchema
>;
export type ApPaymentDigestLog = typeof apPaymentDigestLogTable.$inferSelect;
