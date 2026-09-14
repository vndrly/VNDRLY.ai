import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

export const workerSubscriptionsTable = pgTable("worker_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  payorOrgType: text("payor_org_type").notNull(),
  payorVendorId: integer("payor_vendor_id").references(() => vendorsTable.id),
  payorPartnerId: integer("payor_partner_id").references(() => partnersTable.id),
  workerUserId: integer("worker_user_id").notNull().references(() => usersTable.id),
  plan: text("plan").notNull(),
  monthlyPriceCents: integer("monthly_price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  renewalAt: timestamp("renewal_at", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("active"),
  renews: boolean("renews").notNull().default(true),
  accessEndsAt: timestamp("access_ends_at", { withTimezone: true }),
  billingEndsAt: timestamp("billing_ends_at", { withTimezone: true }),
  foundingSiteLocationId: integer("founding_site_location_id").references(() => siteLocationsTable.id),
  previewAccess: boolean("preview_access").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  auditActorUserId: integer("audit_actor_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeVendorWorkerUnique: uniqueIndex("worker_subscriptions_active_vendor_worker_unique")
    .on(table.payorVendorId, table.workerUserId)
    .where(sql`${table.payorVendorId} is not null and ${table.state} <> 'terminated'`),
  activePartnerWorkerUnique: uniqueIndex("worker_subscriptions_active_partner_worker_unique")
    .on(table.payorPartnerId, table.workerUserId)
    .where(sql`${table.payorPartnerId} is not null and ${table.state} <> 'terminated'`),
  payorLookup: index("worker_subscriptions_payor_idx").on(table.payorOrgType, table.payorVendorId, table.payorPartnerId, table.state),
  workerLookup: index("worker_subscriptions_worker_idx").on(table.workerUserId, table.state),
  payorCheck: check("worker_subscriptions_payor_check", sql`(${table.payorOrgType} = 'vendor' and ${table.payorVendorId} is not null and ${table.payorPartnerId} is null) or (${table.payorOrgType} = 'partner' and ${table.payorPartnerId} is not null and ${table.payorVendorId} is null)`),
  planCheck: check("worker_subscriptions_plan_check", sql`${table.plan} in ('gate_only', 'full_worker')`),
  stateCheck: check("worker_subscriptions_state_check", sql`${table.state} in ('active', 'paused', 'terminated')`),
  currencyCheck: check("worker_subscriptions_currency_check", sql`${table.currency} = 'USD'`),
  priceCheck: check("worker_subscriptions_price_check", sql`${table.monthlyPriceCents} >= 0`),
}));

export type WorkerSubscriptionRow = typeof workerSubscriptionsTable.$inferSelect;
