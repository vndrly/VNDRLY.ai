import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { managedSubcontractorOrganizationsTable } from "./managedSubcontractors";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

export const workParticipationAuthorizationsTable = pgTable(
  "work_participation_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    sponsorVendorId: integer("sponsor_vendor_id").notNull().references(() => vendorsTable.id),
    managedOrganizationId: uuid("managed_organization_id")
      .notNull()
      .references(() => managedSubcontractorOrganizationsTable.id),
    authorizationVersion: text("authorization_version").notNull(),
    source: text("source").notNull().default("account_activation"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    userVersionUnique: uniqueIndex("work_participation_authorization_unique").on(
      table.userId,
      table.sponsorVendorId,
      table.managedOrganizationId,
      table.authorizationVersion,
    ),
    scopeLookup: index("work_participation_authorization_scope_idx").on(
      table.sponsorVendorId,
      table.managedOrganizationId,
      table.userId,
    ),
  }),
);

export type WorkParticipationAuthorization =
  typeof workParticipationAuthorizationsTable.$inferSelect;
