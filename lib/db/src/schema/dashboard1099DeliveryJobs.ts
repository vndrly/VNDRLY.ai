import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

// Task #272 — async job queue for the "Send 1099 statements" action.
//
// The synchronous version of `POST /reports/{admin,partner/:id}/1099-deliver`
// looped over every consenting vendor inside the HTTP request, rendering a
// PDF and calling SendGrid for each one. With 50+ recipients the browser
// request would time out before the loop finished, leaving partners staring
// at a frozen button with no idea whether the send actually completed.
//
// The new flow enqueues a row here, returns 202 with the job id, and a
// background worker (kicked off via `setImmediate` in the same Node
// process) processes the row. The Dashboard1099Card polls
// `GET /reports/.../1099-deliver/jobs/:id` for live progress.
//
// Status lifecycle:
//   pending   -> row inserted, worker not yet started
//   running   -> worker has begun processing
//   completed -> worker finished (errors recorded in `errorsJson`)
//   failed    -> worker crashed before it could finish; counts may be
//                partial. Server boot also re-marks any stranded
//                `running` rows as `failed` because in-process workers
//                lose state on restart.
//
// `errorsJson` is the same `errors` payload shape the synchronous
// endpoint used to return inline so the frontend can surface per-vendor
// failures without a second query.
export const DASHBOARD_1099_DELIVERY_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type Dashboard1099DeliveryJobStatus =
  (typeof DASHBOARD_1099_DELIVERY_JOB_STATUSES)[number];

export const DASHBOARD_1099_DELIVERY_JOB_SCOPES = ["admin", "partner"] as const;
export type Dashboard1099DeliveryJobScope =
  (typeof DASHBOARD_1099_DELIVERY_JOB_SCOPES)[number];

export interface Dashboard1099DeliveryJobError {
  recipientVendorId: number;
  recipientName: string;
  formType: string;
  message: string;
}

export const dashboard1099DeliveryJobsTable = pgTable(
  "dashboard_1099_delivery_jobs",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    partnerId: integer("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    taxYear: integer("tax_year").notNull(),
    formType: text("form_type").notNull(),
    // Optional whitelist (mirrors the request body); null => every dashboard
    // row in scope. Stored as JSONB so the worker can iterate without an
    // extra parse step.
    recipientVendorIds: jsonb("recipient_vendor_ids").$type<number[] | null>(),
    status: text("status").notNull().default("pending"),
    totalCount: integer("total_count").notNull().default(0),
    attempted: integer("attempted").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    skippedNoConsent: integer("skipped_no_consent").notNull().default(0),
    errorsJson: jsonb("errors_json").$type<
      Dashboard1099DeliveryJobError[]
    >().notNull().default([]),
    lastErrorMessage: text("last_error_message"),
    createdByUserId: integer("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    idxScope: index("dashboard_1099_delivery_jobs_scope_idx").on(
      t.scope,
      t.partnerId,
      t.createdAt,
    ),
    idxStatus: index("dashboard_1099_delivery_jobs_status_idx").on(t.status),
  }),
);

export const insertDashboard1099DeliveryJobSchema = createInsertSchema(
  dashboard1099DeliveryJobsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDashboard1099DeliveryJob = z.infer<
  typeof insertDashboard1099DeliveryJobSchema
>;
export type Dashboard1099DeliveryJob =
  typeof dashboard1099DeliveryJobsTable.$inferSelect;
