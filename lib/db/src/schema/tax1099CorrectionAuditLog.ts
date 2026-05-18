import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { tax1099FilingsTable } from "./tax1099Filings";

// Append-only audit trail of every transition of
// `tax_1099_filings.corrected_status`. Each PATCH/POST that changes the
// correction indicator (including back to "none") writes one row here so
// admins have a defensible record of *who* flipped a filing to CORR-G/C
// and *when* — flipping that bit causes the next IRS FIRE export to emit
// a corrected B record, which is a tax-significant action.
//
// We mirror the actor capture used by `report_export_audit_log`
// (downloaded_by_user_id / user_ip / user_agent) and the diff capture
// used by `fire_transmitter_settings_audit_log`, but kept slim because
// only one column is ever changing.
export const tax1099CorrectionAuditLogTable = pgTable(
  "tax_1099_correction_audit_log",
  {
    id: serial("id").primaryKey(),
    // Audit history must outlive the filing row it describes — admins
    // need to defend "who marked CORR-G on April 25" even if the parent
    // filing is later hard-deleted. We therefore use `set null` rather
    // than `cascade`. The denormalised tax_year / form_type /
    // payer_partner_id / recipient_vendor_id columns below preserve
    // enough scope to reconstruct the row identity after a delete.
    filingId: integer("filing_id").references(() => tax1099FilingsTable.id, {
      onDelete: "set null",
    }),
    // Denormalised filing-scope columns so an admin audit query can group
    // / filter without an extra join even after the parent filing row's
    // FK has been nulled out by a delete.
    taxYear: integer("tax_year").notNull(),
    formType: text("form_type").notNull(),
    payerPartnerId: integer("payer_partner_id").notNull(),
    recipientVendorId: integer("recipient_vendor_id").notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    actorIp: text("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxFiling: index("tax_1099_correction_audit_filing_idx").on(
      t.filingId,
      t.createdAt,
    ),
    idxCreatedAt: index("tax_1099_correction_audit_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertTax1099CorrectionAuditLogSchema = createInsertSchema(
  tax1099CorrectionAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertTax1099CorrectionAuditLog = z.infer<
  typeof insertTax1099CorrectionAuditLogSchema
>;
export type Tax1099CorrectionAuditLog =
  typeof tax1099CorrectionAuditLogTable.$inferSelect;
