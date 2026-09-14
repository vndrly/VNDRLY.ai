import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { workHubCrewsTable } from "./workHubCollaboration";

export const managedSubcontractorOrganizationsTable = pgTable(
  "managed_subcontractor_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    canonicalName: text("canonical_name").notNull(),
    status: text("status").notNull().default("managed"),
    createdByVendorId: integer("created_by_vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    claimedVendorId: integer("claimed_vendor_id").references(() => vendorsTable.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sponsorNameLookup: index("managed_subcontractor_org_sponsor_name_idx").on(
      table.createdByVendorId,
      table.canonicalName,
    ),

    statusCheck: check(
      "managed_subcontractor_org_status_check",
      sql`${table.status} in ('managed', 'claimed', 'archived')`,
    ),
  }),
);

export const managedSubcontractorSponsorsTable = pgTable(
  "managed_subcontractor_sponsors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managedOrganizationId: uuid("managed_organization_id")
      .notNull()
      .references(() => managedSubcontractorOrganizationsTable.id),
    sponsorVendorId: integer("sponsor_vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    activeSponsorUnique: uniqueIndex("managed_subcontractor_active_sponsor_unique")
      .on(table.managedOrganizationId, table.sponsorVendorId)
      .where(sql`${table.status} = 'active'`),
    vendorLookup: index("managed_subcontractor_sponsor_vendor_idx").on(
      table.sponsorVendorId,
      table.status,
    ),
    statusCheck: check(
      "managed_subcontractor_sponsor_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  }),
);

export const managedSubcontractorWorkerSponsorshipsTable = pgTable(
  "managed_subcontractor_worker_sponsorships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workerUserId: integer("worker_user_id")
      .notNull()
      .references(() => usersTable.id),
    sponsorVendorId: integer("sponsor_vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    managedOrganizationId: uuid("managed_organization_id")
      .notNull()
      .references(() => managedSubcontractorOrganizationsTable.id),
    status: text("status").notNull().default("active"),
    invitedByUserId: integer("invited_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    activeWorkerSponsorshipUnique: uniqueIndex(
      "managed_subcontractor_active_worker_sponsorship_unique",
    )
      .on(table.workerUserId, table.sponsorVendorId, table.managedOrganizationId)
      .where(sql`${table.status} = 'active'`),
    workerLookup: index("managed_subcontractor_worker_lookup_idx").on(
      table.workerUserId,
      table.sponsorVendorId,
      table.status,
    ),
    statusCheck: check(
      "managed_subcontractor_worker_status_check",
      sql`${table.status} in ('active', 'paused', 'terminated')`,
    ),
  }),
);

export const managedSubcontractorRoleGrantsTable = pgTable(
  "managed_subcontractor_role_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sponsorshipId: uuid("sponsorship_id")
      .notNull()
      .references(() => managedSubcontractorWorkerSponsorshipsTable.id),
    role: text("role").notNull(),
    siteId: integer("site_id").references(() => siteLocationsTable.id),
    crewId: uuid("crew_id").references(() => workHubCrewsTable.id),
    status: text("status").notNull().default("active"),
    grantedByUserId: integer("granted_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    activeSiteGrantUnique: uniqueIndex("managed_subcontractor_active_site_role_grant_unique")
      .on(table.sponsorshipId, table.role, table.siteId)
      .where(sql`${table.status} = 'active' and ${table.siteId} is not null`),
    activeCrewGrantUnique: uniqueIndex("managed_subcontractor_active_crew_role_grant_unique")
      .on(table.sponsorshipId, table.role, table.crewId)
      .where(sql`${table.status} = 'active' and ${table.crewId} is not null`),
    sponsorshipLookup: index("managed_subcontractor_role_grant_sponsorship_idx").on(
      table.sponsorshipId,
      table.status,
    ),
    scopeCheck: check(
      "managed_subcontractor_role_grant_scope_check",
      sql`${table.siteId} is not null or ${table.crewId} is not null`,
    ),
    roleCheck: check(
      "managed_subcontractor_role_grant_role_check",
      sql`${table.role} in ('managed_company_manager', 'gatekeeper', 'gate_supervisor', 'foreman', 'asset_manager', 'safety_manager')`,
    ),
    statusCheck: check(
      "managed_subcontractor_role_grant_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  }),
);

export const managedSubcontractorClaimsTable = pgTable(
  "managed_subcontractor_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managedOrganizationId: uuid("managed_organization_id")
      .notNull()
      .references(() => managedSubcontractorOrganizationsTable.id),
    claimedVendorId: integer("claimed_vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    representativeUserId: integer("representative_user_id")
      .notNull()
      .references(() => usersTable.id),
    claimedByUserId: integer("claimed_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    workerIdentitySnapshot: jsonb("worker_identity_snapshot")
      .$type<number[]>()
      .notNull()
      .default([]),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationClaimUnique: uniqueIndex("managed_subcontractor_claim_org_unique").on(
      table.managedOrganizationId,
    ),
    claimedVendorLookup: index("managed_subcontractor_claim_vendor_idx").on(
      table.claimedVendorId,
    ),
  }),
);

export type ManagedSubcontractorOrganization =
  typeof managedSubcontractorOrganizationsTable.$inferSelect;
export type ManagedSubcontractorWorkerSponsorship =
  typeof managedSubcontractorWorkerSponsorshipsTable.$inferSelect;
