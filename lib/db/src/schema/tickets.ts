import { pgTable, text, serial, timestamp, integer, doublePrecision, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { siteLocationsTable } from "./siteLocations";
import { vendorsTable } from "./vendors";
import { fieldEmployeesTable } from "./vendorPeople";
import { workTypesTable } from "./workTypes";

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  fieldEmployeeId: integer("field_employee_id").references(() => fieldEmployeesTable.id),
  workTypeId: integer("work_type_id").notNull().references(() => workTypesTable.id),
  // Lifecycle status. Legal values:
  //   initiated | in_progress | pending_review | submitted | approved
  //   kicked_back | awaiting_acceptance | denied | funds_dispersed
  //   completed | cancelled
  // The legacy value `draft` is still tolerated on read for tickets created
  // before Task #493; new tickets are always created as `initiated`.
  status: text("status").notNull().default("initiated"),
  // How this ticket was opened — drives later analytics on which intake
  // channel partners and the back-office actually use day-to-day. Backfilled
  // to `partner_self_service` for every existing row.
  intakeChannel: text("intake_channel")
    .notNull()
    .default("partner_self_service"),
  description: text("description"),
  notes: text("notes"),
  kickbackReason: text("kickback_reason"),
  checkInTime: timestamp("check_in_time", { withTimezone: true }),
  checkOutTime: timestamp("check_out_time", { withTimezone: true }),
  checkInLatitude: doublePrecision("check_in_latitude"),
  checkInLongitude: doublePrecision("check_in_longitude"),
  checkOutLatitude: doublePrecision("check_out_latitude"),
  checkOutLongitude: doublePrecision("check_out_longitude"),
  lifecycleState: text("lifecycle_state"),
  enRouteAt: timestamp("en_route_at", { withTimezone: true }),
  // Vendor pressed "On Location" — they have arrived at the site but are
  // not on the clock yet (no check-in). Distinct from `arrivedAt` (which
  // tracks geofence-detected arrival) so the boss can see the difference
  // between "physically present, not working" and "checked in, billing".
  onLocationAt: timestamp("on_location_at", { withTimezone: true }),
  onLocationLatitude: doublePrecision("on_location_latitude"),
  onLocationLongitude: doublePrecision("on_location_longitude"),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  departureLatitude: doublePrecision("departure_latitude"),
  departureLongitude: doublePrecision("departure_longitude"),
  // T004: odometer reading captured by the field employee at the moment they
  // press "En Route" (start) and "Check Out" (end). Both are nullable so
  // legacy tickets and tickets where the crew skipped odometer entry stay
  // valid. Numeric(10,1) supports up to 999,999,999.9 mi which is far beyond
  // any plausible vehicle reading; one decimal place matches how truck
  // dashboards display the value.
  startingMileage: numeric("starting_mileage", { precision: 10, scale: 1 }),
  endingMileage: numeric("ending_mileage", { precision: 10, scale: 1 }),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  unlockedById: integer("unlocked_by_id"),
  unlockCount: integer("unlock_count").notNull().default(0),
  createdById: integer("created_by_id"),
  closedById: integer("closed_by_id"),
  // Foreman / vendor-admin / org-admin pressed "Close Ticket" — the running
  // [auto] labor lines are crystallized into final billable rows at this
  // moment and `regenerateAutoLaborLines` becomes a no-op for this ticket.
  // Lines remain editable as manual rows so accounting can still tweak.
  // Distinct from `approvedAt` (back-office accounting sign-off) and from
  // `checkOutTime` (the last person clocked out).
  closedAt: timestamp("closed_at", { withTimezone: true }),
  preCancelStatus: text("pre_cancel_status"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledById: integer("cancelled_by_id"),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
  scheduledDurationMinutes: integer("scheduled_duration_minutes"),
  foremanUserId: integer("foreman_user_id"),
  actingForemanUserId: integer("acting_foreman_user_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  scheduledById: integer("scheduled_by_id"),
  lateCheckInReminderSentAt: timestamp("late_check_in_reminder_sent_at", { withTimezone: true }),
  // Immutable accounting timestamp: set ONCE on the draft→approved
  // transition. Used by invoice generation to resolve the billing period so
  // that unrelated subsequent edits to the ticket (which bump updatedAt) do
  // not silently shift charges to a different invoice.
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // Payment-method metadata, populated by POST /tickets/:id/disperse-funds
  // (Task #497). All five columns flip together inside one transaction with
  // status='funds_dispersed'; status_history.reason captures the same note.
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  paymentNote: text("payment_note"),
  paymentDispersedAt: timestamp("payment_dispersed_at", { withTimezone: true }),
  paymentDispersedById: integer("payment_dispersed_by_id"),
  // Optional proof-of-payment image captured by AP at the moment funds are
  // dispersed (Task #852). Stored as the object-storage path/URL returned
  // by the upload helper; surfaced read-only on the Payment Details panel
  // in both the web and mobile clients. Nullable: existing dispersals
  // pre-date this column and AP can still record a payment without a
  // receipt photo.
  paymentReceiptUrl: text("payment_receipt_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, status: true, createdAt: true, updatedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
