import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { vendorPeopleTable } from "./vendorPeople";

export const userOrgMembershipsTable = pgTable(
  "user_org_memberships",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    orgType: text("org_type").notNull(),
    partnerId: integer("partner_id").references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    vendorPeopleId: integer("vendor_people_id").references(() => vendorPeopleTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // (user, partner) is unique among partner rows; vendor rows have partner_id NULL
    // and Postgres treats NULLs as distinct, so vendor rows are not constrained here.
    userPartnerUnique: uniqueIndex("user_org_memberships_user_partner_unique")
      .on(t.userId, t.partnerId),
    // Symmetric for vendor rows.
    userVendorUnique: uniqueIndex("user_org_memberships_user_vendor_unique")
      .on(t.userId, t.vendorId),
    // Lookup helpers for resolveContext() (filters by userId) and reverse joins.
    userIdx: index("user_org_memberships_user_idx").on(t.userId),
    orgIdx: index("user_org_memberships_org_idx").on(t.orgType, t.partnerId, t.vendorId),
    // Schema-enforced shape: orgType must be one of the two known values, and
    // exactly one of partner_id / vendor_id must be set, matching orgType.
    orgTypeCheck: check(
      "user_org_memberships_org_type_check",
      sql`${t.orgType} IN ('partner','vendor')`,
    ),
    orgShapeCheck: check(
      "user_org_memberships_org_shape_check",
      sql`(
        (${t.orgType} = 'partner' AND ${t.partnerId} IS NOT NULL AND ${t.vendorId} IS NULL)
        OR
        (${t.orgType} = 'vendor' AND ${t.vendorId} IS NOT NULL AND ${t.partnerId} IS NULL)
      )`,
    ),
    // In-org roles are limited to a known set so session-role derivation
    // is deterministic and authorization checks can rely on the value.
    // 'ap' is a partner-org-only role that grants Accounts Payable
    // authority (disperse funds) without the broader admin powers; it
    // resolves to a 'partner' session role just like 'member' does.
    roleCheck: check(
      "user_org_memberships_role_check",
      sql`${t.role} IN ('admin','member','ap','field_employee')`,
    ),
  }),
);

export const insertUserOrgMembershipSchema = createInsertSchema(userOrgMembershipsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUserOrgMembership = z.infer<typeof insertUserOrgMembershipSchema>;
export type UserOrgMembership = typeof userOrgMembershipsTable.$inferSelect;
