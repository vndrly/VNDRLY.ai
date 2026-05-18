import { pgTable, text, serial, timestamp, integer, boolean, date, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

export const vendorPeopleTable = pgTable("vendor_people", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  vendorRole: text("vendor_role").notNull().default("office"),
  roles: text("roles").array().notNull().default([]),
  jobTitle: text("job_title"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  pecCertification: boolean("pec_certification").notNull().default(false),
  pecExpirationDate: date("pec_expiration_date"),
  photoUrl: text("photo_url"),
  profilePhotoPath: text("profile_photo_path"),
  hourlyRate: numeric("hourly_rate", { precision: 8, scale: 2 }),
  // T005: how this employee's labor is billed. "hourly" (default) keeps the
  // existing OT-aware rollup driven by `hourly_rate`. "daily" switches to a
  // flat per-day rate stored in `daily_rate` and turns OT calculation off
  // (a day rate is a day rate regardless of hours worked). Stored as text +
  // app-level enum so we can add additional kinds (e.g. "fixed_per_ticket")
  // without a migration.
  rateKind: text("rate_kind").notNull().default("hourly"),
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }),
  userId: integer("user_id").unique().references(() => usersTable.id, { onDelete: "set null" }),
  // One-time, opaque token emailed to a new field employee so they can
  // walk through the onboarding wizard without an existing login. The
  // token is cleared once the employee completes the wizard (sets a
  // password, becomes a real user). Indexed unique so resolution by
  // token is O(1) and collisions are rejected at the DB layer.
  inviteToken: text("invite_token").unique(),
  inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }),
  // Language the invitee selected on the public onboarding page (one of
  // "en" or "es"; null until the toggle is touched). Populated *before*
  // the invitee finishes set-password, so the token-mode assistant can
  // prime in the right language from the very first turn — at which
  // point there is no `users` row yet and `users.preferred_language` is
  // therefore unavailable. Once the invitee completes the wizard the
  // value is also mirrored into `users.preferred_language` so post-auth
  // sessions key off the same preference.
  preferredLanguage: text("preferred_language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
});

export const insertVendorPersonSchema = createInsertSchema(vendorPeopleTable).omit({ id: true, isActive: true, createdAt: true });
export type InsertVendorPerson = z.infer<typeof insertVendorPersonSchema>;
export type VendorPerson = typeof vendorPeopleTable.$inferSelect;

// Backwards-compatible aliases — the underlying table is the same.
export const fieldEmployeesTable = vendorPeopleTable;
export const vendorContactsTable = vendorPeopleTable;
export const insertFieldEmployeeSchema = insertVendorPersonSchema;
export const insertVendorContactSchema = insertVendorPersonSchema;
export type InsertFieldEmployee = InsertVendorPerson;
export type InsertVendorContact = InsertVendorPerson;
export type FieldEmployee = VendorPerson;
export type VendorContact = VendorPerson;
