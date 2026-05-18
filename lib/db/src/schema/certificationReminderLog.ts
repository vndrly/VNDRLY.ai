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
import { employeeCertificationsTable } from "./employeeCertifications";

// Task #45 — certification expiration reminder dedupe log.
//
// One row per (certification, threshold) reminder fired by the daily
// certification reminder worker. The unique `dedupe_key`
// (`cert_expiration:<threshold>d:<certificationId>`) ensures the same
// (cert, threshold) pair never produces more than one delivered
// reminder, even across worker restarts or repeated daily runs.
//
// Retry semantics mirror invoice-aging: if the digest send fails
// after a successful claim, `failure_message` is populated so the
// next scan re-attempts delivery without re-claiming the dedupe row.
export const certificationReminderLogTable = pgTable(
  "certification_reminder_log",
  {
    id: serial("id").primaryKey(),
    certificationId: integer("certification_id")
      .notNull()
      .references(() => employeeCertificationsTable.id, {
        onDelete: "cascade",
      }),
    // "60d" | "30d" | "7d"
    threshold: text("threshold").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // The vendor digest the cert was rolled into (NULL for admin-only fires
    // or when no vendor recipients existed). Diagnostic only.
    sentToVendorId: integer("sent_to_vendor_id"),
    failureMessage: text("failure_message"),
  },
  (t) => ({
    idxCert: index("certification_reminder_log_cert_idx").on(t.certificationId),
    uniqDedupe: uniqueIndex("certification_reminder_log_dedupe_unique").on(
      t.dedupeKey,
    ),
  }),
);

export const insertCertificationReminderLogSchema = createInsertSchema(
  certificationReminderLogTable,
).omit({ id: true });
export type InsertCertificationReminderLog = z.infer<
  typeof insertCertificationReminderLogSchema
>;
export type CertificationReminderLog =
  typeof certificationReminderLogTable.$inferSelect;
