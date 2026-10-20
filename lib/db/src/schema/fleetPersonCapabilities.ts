import { foreignKey, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userOrgMembershipsTable } from "./userOrgMemberships";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

/** One versioned current grant set per vendor member. Revocation removes capabilities from this set. */
export const fleetPersonCapabilitiesTable = pgTable("fleet_person_capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => vendorsTable.id),
  userId: integer("user_id").notNull(),
  capabilities: text("capabilities").array().notNull().default([]),
  version: integer("version").notNull().default(1),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyUserUnique: uniqueIndex("fleet_person_capabilities_company_user_unique").on(t.companyId, t.userId),
  memberFk: foreignKey({ name: "fleet_person_capabilities_member_fk", columns: [t.userId, t.companyId], foreignColumns: [userOrgMembershipsTable.userId, userOrgMembershipsTable.vendorId] }).onDelete("cascade"),
}));

export type FleetPersonCapabilitiesRecord = typeof fleetPersonCapabilitiesTable.$inferSelect;
