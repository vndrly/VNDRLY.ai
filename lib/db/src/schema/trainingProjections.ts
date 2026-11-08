import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Worker-produced read models. HTTP readers never calculate or refresh them. */
export const trainingReadProjectionsTable = pgTable("training_read_projections", {
  projectionKey: text("projection_key").primaryKey(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
}).enableRLS();

/** Mutation-only dirty queue; completion is acknowledged by the background worker. */
export const trainingProjectionQueueTable = pgTable("training_projection_queue", {
  ownerKey: text("owner_key").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
  attempts: integer("attempts").default(0),
}).enableRLS();
