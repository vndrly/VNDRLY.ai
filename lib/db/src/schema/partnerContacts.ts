import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

export const partnerContactsTable = pgTable("partner_contacts", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  jobTitle: text("job_title").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  roles: text("roles").array().notNull().default([]),
  photoUrl: text("photo_url"),
  preferredLocale: text("preferred_locale").notNull().default("en"),
  // Bug #5 fix: partner-contact magic-link invite. Mirrors the
  // vendor_people invite flow — partner admin clicks "Invite" on a
  // contact row, we mint a token + email a link. The invitee follows
  // the link to set a password, at which point we create a users row
  // + partner-admin membership and clear the token.
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  inviteToken: text("invite_token").unique(),
  inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
});

export const insertPartnerContactSchema = createInsertSchema(partnerContactsTable).omit({ id: true, createdAt: true });
export type InsertPartnerContact = z.infer<typeof insertPartnerContactSchema>;
export type PartnerContact = typeof partnerContactsTable.$inferSelect;
