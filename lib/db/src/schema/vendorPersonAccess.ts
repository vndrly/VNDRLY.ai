import { check, integer, pgTable, serial, text, timestamp, uniqueIndex, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
import { vendorPeopleTable } from "./vendorPeople";

export const VENDOR_PERSON_OPERATIONAL_ROLES = [
  "office",
  "field_employee",
  "foreman",
  "gatekeeper",
  "gate_supervisor",
] as const;

export type VendorPersonOperationalRole =
  (typeof VENDOR_PERSON_OPERATIONAL_ROLES)[number];

export const vendorPersonOperationalRolesTable = pgTable(
  "vendor_person_operational_roles",
  {
    id: serial("id").primaryKey(),
    vendorPeopleId: integer("vendor_people_id")
      .notNull()
      .references(() => vendorPeopleTable.id, { onDelete: "cascade" }),
    role: text("role").$type<VendorPersonOperationalRole>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personRoleUnique: uniqueIndex("vendor_person_operational_roles_unique").on(
      table.vendorPeopleId,
      table.role,
    ),
    personActiveLookup: index("vendor_person_operational_roles_person_active_idx").on(
      table.vendorPeopleId,
      table.isActive,
    ),
    roleCheck: check(
      "vendor_person_operational_roles_role_check",
      sql`${table.role} in ('office','field_employee','foreman','gatekeeper','gate_supervisor')`,
    ),
  }),
);

export const vendorPersonSiteAccessTable = pgTable(
  "vendor_person_site_access",
  {
    id: serial("id").primaryKey(),
    vendorPeopleId: integer("vendor_people_id")
      .notNull()
      .references(() => vendorPeopleTable.id, { onDelete: "cascade" }),
    siteLocationId: integer("site_location_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personSiteUnique: uniqueIndex("vendor_person_site_access_unique").on(
      table.vendorPeopleId,
      table.siteLocationId,
    ),
    personActiveLookup: index("vendor_person_site_access_person_active_idx").on(
      table.vendorPeopleId,
      table.isActive,
    ),
  }),
);

export type VendorPersonOperationalRoleGrant =
  typeof vendorPersonOperationalRolesTable.$inferSelect;
export type VendorPersonSiteAccessGrant =
  typeof vendorPersonSiteAccessTable.$inferSelect;
