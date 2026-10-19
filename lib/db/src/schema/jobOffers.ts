import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { siteLocationsTable } from "./siteLocations";
import { workTypesTable } from "./workTypes";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";
import { canonicalServicesTable } from "./canonicalServices";
import { vendorCapabilitiesTable, vendorPartnerServiceOffersTable } from "./vendorCapabilities";

export const JOB_OFFER_STATUSES = ["draft", "offered", "vendor_reviewing", "accepted", "declined", "expired", "withdrawn"] as const;
export type JobOfferStatus = typeof JOB_OFFER_STATUSES[number];

export const jobOffersTable = pgTable("job_offers", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
  workTypeId: integer("work_type_id").notNull().references(() => workTypesTable.id),
  canonicalServiceId: integer("canonical_service_id").notNull().references(() => canonicalServicesTable.id),
  vendorCapabilityId: integer("vendor_capability_id").notNull().references(() => vendorCapabilitiesTable.id),
  vendorPartnerServiceOfferId: integer("vendor_partner_service_offer_id").notNull().references(() => vendorPartnerServiceOffersTable.id),
  commercialSnapshot: jsonb("commercial_snapshot").$type<Record<string, unknown>>().notNull(),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
  scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
  crewCount: integer("crew_count").notNull().default(1),
  scope: text("scope").notNull(),
  attachments: jsonb("attachments").$type<unknown[]>(),
  afeReference: text("afe_reference"),
  poReference: text("po_reference"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status", { enum: JOB_OFFER_STATUSES }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  createdTicketId: integer("created_ticket_id").references((): AnyPgColumn => ticketsTable.id),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentById: integer("sent_by_id").references(() => usersTable.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedById: integer("accepted_by_id").references(() => usersTable.id),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declinedById: integer("declined_by_id").references(() => usersTable.id),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawnById: integer("withdrawn_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("job_offers_partner_idempotency_unique").on(t.partnerId, t.idempotencyKey),
  uniqueIndex("job_offers_created_ticket_unique").on(t.createdTicketId),
  check("job_offers_crew_positive", sql`${t.crewCount} > 0`),
  check("job_offers_version_positive", sql`${t.version} > 0`),
  check("job_offers_schedule_order", sql`${t.scheduledEndAt} is null or (${t.scheduledStartAt} is not null and ${t.scheduledEndAt} > ${t.scheduledStartAt})`),
  check("job_offers_status_valid", sql`${t.status} in (${sql.join(JOB_OFFER_STATUSES.map((value) => sql.raw(`'${value}'`)), sql`, `)})`),
]).enableRLS();

// Written once by the acceptance transaction before the ticket is created.
export const jobOfferAcceptanceSnapshotsTable = pgTable("job_offer_acceptance_snapshots", {
  id: serial("id").primaryKey(),
  jobOfferId: integer("job_offer_id").notNull().references(() => jobOffersTable.id),
  offerVersion: integer("offer_version").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  acceptedById: integer("accepted_by_id").notNull().references(() => usersTable.id),
  commercialSnapshot: jsonb("commercial_snapshot").$type<Record<string, unknown>>().notNull(),
  scopeSnapshot: jsonb("scope_snapshot").$type<Record<string, unknown>>().notNull(),
  coverageSnapshot: jsonb("coverage_snapshot").$type<Record<string, unknown>>().notNull(),
  eligibilitySnapshot: jsonb("eligibility_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("job_offer_acceptance_snapshots_offer_unique").on(t.jobOfferId),
  uniqueIndex("job_offer_acceptance_snapshots_operation_unique").on(t.acceptedById, t.idempotencyKey),
  check("job_offer_acceptance_snapshots_version_positive", sql`${t.offerVersion} > 0`),
]).enableRLS();

export type JobOffer = typeof jobOffersTable.$inferSelect;
export type JobOfferAcceptanceSnapshot = typeof jobOfferAcceptanceSnapshotsTable.$inferSelect;
