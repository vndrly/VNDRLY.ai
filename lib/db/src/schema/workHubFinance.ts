import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Work Hub manual billing/payroll records. Ticket invoices remain in invoices. */
export const workHubFinanceRecordsTable = pgTable(
  "work_hub_finance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgType: text("org_type").notNull(),
    orgId: integer("org_id").notNull(),
    kind: text("kind").notNull(),
    recordKey: text("record_key").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerKind: index("work_hub_finance_owner_kind_idx").on(
      t.orgType,
      t.orgId,
      t.kind,
    ),
    recordUnique: uniqueIndex("work_hub_finance_record_unique").on(
      t.orgType,
      t.orgId,
      t.kind,
      t.recordKey,
    ),
  }),
);
