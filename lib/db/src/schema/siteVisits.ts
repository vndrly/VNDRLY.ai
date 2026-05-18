import { pgTable, text, serial, timestamp, integer, doublePrecision, boolean, index } from "drizzle-orm/pg-core";
import { siteLocationsTable } from "./siteLocations";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";

export const guestSessionsTable = pgTable(
  "guest_sessions",
  {
    id: serial("id").primaryKey(),
    tokenJti: text("token_jti").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    company: text("company"),
    vehiclePlate: text("vehicle_plate"),
    lastPurpose: text("last_purpose"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    expiresIdx: index("guest_sessions_expires_idx").on(t.expiresAt),
  }),
);

export type GuestSession = typeof guestSessionsTable.$inferSelect;

export const siteVisitsTable = pgTable(
  "site_visits",
  {
    id: serial("id").primaryKey(),
    siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
    guestSessionId: integer("guest_session_id").references(() => guestSessionsTable.id, { onDelete: "set null" }),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    company: text("company"),
    vehiclePlate: text("vehicle_plate"),
    purpose: text("purpose"),
    expectedDurationMinutes: integer("expected_duration_minutes"),

    // Host can be a partner OR a vendor (the visitor picks exactly one).
    hostType: text("host_type").notNull(), // 'partner' | 'vendor'
    hostPartnerId: integer("host_partner_id").references(() => partnersTable.id),
    hostVendorId: integer("host_vendor_id").references(() => vendorsTable.id),

    checkInTime: timestamp("check_in_time", { withTimezone: true }).notNull().defaultNow(),
    checkInLatitude: doublePrecision("check_in_latitude"),
    checkInLongitude: doublePrecision("check_in_longitude"),
    checkOutTime: timestamp("check_out_time", { withTimezone: true }),
    checkOutLatitude: doublePrecision("check_out_latitude"),
    checkOutLongitude: doublePrecision("check_out_longitude"),
    autoCheckedOut: boolean("auto_checked_out").notNull().default(false),

    safetyAcknowledgedAt: timestamp("safety_acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    siteIdx: index("site_visits_site_idx").on(t.siteLocationId),
    activeIdx: index("site_visits_active_idx").on(t.siteLocationId, t.checkOutTime),
    hostPartnerIdx: index("site_visits_host_partner_idx").on(t.hostPartnerId),
    hostVendorIdx: index("site_visits_host_vendor_idx").on(t.hostVendorId),
  }),
);

export type SiteVisit = typeof siteVisitsTable.$inferSelect;
