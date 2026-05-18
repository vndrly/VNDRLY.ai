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
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

// Task #853 — Append-only snapshot table for payment lifecycle events
// originated through the AP-self-service "Reverse dispersal" flow on
// POST /tickets/:id/reverse-dispersal. One row per reversal captures
// WHO reversed it, WHY, and a verbatim copy of the five payment columns
// at the moment they were cleared so a later audit can reconstruct
// "what was the ticket actually paying when it was reversed?" without
// joining the (already overwritten) ticket row.
//
// `actorRole` is stamped at write time because role/membership changes
// would otherwise rewrite the historical record. `actor_user_id` uses
// onDelete:set null so deactivating an AP contact preserves the audit
// row instead of cascading it away. `ticket_id` cascades because the
// audit is meaningless without its ticket.
export const paymentAuditTable = pgTable(
  "payment_audit",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    // Discriminator for future expansion. Today the only writer is the
    // reverse-dispersal endpoint, which writes "dispersal_reversed".
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    // Verbatim copies of the five payment columns at the moment of
    // reversal, so the audit row is self-contained and survives any
    // later edit (or re-dispersal) on the parent ticket.
    paymentMethodSnapshot: text("payment_method_snapshot"),
    paymentReferenceSnapshot: text("payment_reference_snapshot"),
    paymentNoteSnapshot: text("payment_note_snapshot"),
    paymentDispersedAtSnapshot: timestamp("payment_dispersed_at_snapshot", {
      withTimezone: true,
    }),
    paymentDispersedByIdSnapshot: integer("payment_dispersed_by_id_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxTicket: index("payment_audit_ticket_idx").on(t.ticketId, t.createdAt),
    idxCreatedAt: index("payment_audit_created_idx").on(t.createdAt),
  }),
);

export const insertPaymentAuditSchema = createInsertSchema(
  paymentAuditTable,
).omit({ id: true, createdAt: true });
export type InsertPaymentAudit = z.infer<typeof insertPaymentAuditSchema>;
export type PaymentAudit = typeof paymentAuditTable.$inferSelect;
