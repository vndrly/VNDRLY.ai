import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { vendorsTable } from "./vendors";
import { vendorPeopleTable } from "./vendorPeople";

/**
 * Tracks per-org progress through the multi-step onboarding wizard.
 *
 * Exactly one of (partnerId, vendorId, vendorPeopleId) is set, indicating
 * which persona's wizard this row belongs to. `payload` is a free-form
 * JSON blob the wizard reads/writes between steps so a partially filled
 * step can be restored on resume. `completedSteps` and `skippedSteps`
 * back the dashboard's "Finish setup" widget.
 */
export const onboardingProgressTable = pgTable(
  "onboarding_progress",
  {
    id: serial("id").primaryKey(),
    orgType: text("org_type").notNull(),
    partnerId: integer("partner_id").references(() => partnersTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "cascade" }),
    vendorPeopleId: integer("vendor_people_id").references(() => vendorPeopleTable.id, { onDelete: "cascade" }),
    currentStep: text("current_step").notNull().default(""),
    completedSteps: text("completed_steps").array().notNull().default([]),
    skippedSteps: text("skipped_steps").array().notNull().default([]),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqPartner: uniqueIndex("onboarding_progress_partner_uniq").on(t.partnerId),
    uniqVendor: uniqueIndex("onboarding_progress_vendor_uniq").on(t.vendorId),
    uniqVendorPerson: uniqueIndex("onboarding_progress_vendor_people_uniq").on(t.vendorPeopleId),
  }),
);

export const insertOnboardingProgressSchema = createInsertSchema(onboardingProgressTable).omit({
  id: true,
  startedAt: true,
  updatedAt: true,
});
export type InsertOnboardingProgress = z.infer<typeof insertOnboardingProgressSchema>;
export type OnboardingProgress = typeof onboardingProgressTable.$inferSelect;
