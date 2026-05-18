import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

// Task #651: audit trail of every platform-admin override of the new
// `blocking_certifications` enforcement on POST /tickets/:id/schedule.
// When a work_type lists blocking certs and a crew member is missing or
// has an expired copy, the route returns 400. Platform admins (role
// "admin") can re-POST with `overrideBlockingCerts: true` to push the
// schedule through anyway — we capture one row per override so a
// compliance review can answer "who scheduled X with missing creds, on
// what ticket, when, and which certs were missing?" without trawling
// through the dispatcher's chat history.
//
// `ticketId` keeps an FK so cascading the ticket away (rare; we usually
// soft-cancel) sets it null instead of orphaning the audit row. The
// `actorRole` column is captured at write time because role changes on
// `userOrgMemberships` would otherwise rewrite the historical record.
export const scheduleCertOverrideAuditLogTable = pgTable(
  "schedule_cert_override_audit_log",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").references(() => ticketsTable.id, {
      onDelete: "set null",
    }),
    /** Snapshot of the work_type's `blocking_certifications` array at
     *  override time, so a future edit to the work type can't rewrite
     *  the audit record. Stored as jsonb for flexibility. */
    blockingCertifications: jsonb("blocking_certifications")
      .$type<string[]>()
      .notNull(),
    /** [{ employeeId, employeeName, missing: string[] }] — the exact
     *  crew + cert combinations that the override pushed through. */
    missingByEmployee: jsonb("missing_by_employee")
      .$type<
        Array<{ employeeId: number; employeeName: string; missing: string[] }>
      >()
      .notNull(),
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
    idxTicket: index("schedule_cert_override_audit_ticket_idx").on(
      t.ticketId,
      t.createdAt,
    ),
    idxCreatedAt: index("schedule_cert_override_audit_created_idx").on(
      t.createdAt,
    ),
  }),
);

export const insertScheduleCertOverrideAuditLogSchema = createInsertSchema(
  scheduleCertOverrideAuditLogTable,
).omit({ id: true, createdAt: true });
export type InsertScheduleCertOverrideAuditLog = z.infer<
  typeof insertScheduleCertOverrideAuditLogSchema
>;
export type ScheduleCertOverrideAuditLog =
  typeof scheduleCertOverrideAuditLogTable.$inferSelect;
