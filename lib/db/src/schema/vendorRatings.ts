import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vendorsTable } from "./vendors";
import { partnersTable } from "./partners";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export const vendorRatingsTable = pgTable(
  "vendor_ratings",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id").references(() => ticketsTable.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    review: text("review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketUnique: uniqueIndex("vendor_ratings_ticket_unique")
      .on(t.ticketId)
      .where(sql`${t.ticketId} IS NOT NULL`),
    vendorPartnerStandaloneUnique: uniqueIndex("vendor_ratings_vendor_partner_standalone_unique")
      .on(t.vendorId, t.partnerId)
      .where(sql`${t.ticketId} IS NULL`),
  }),
);

export type VendorRating = typeof vendorRatingsTable.$inferSelect;
