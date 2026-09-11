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
/** Managed documents reference immutable private work_hub_files objects. */
export const workHubFileLibraryTable = pgTable(
  "work_hub_file_library",
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
    owner: index("work_hub_file_library_owner_idx").on(
      t.orgType,
      t.orgId,
      t.kind,
    ),
    unique: uniqueIndex("work_hub_file_library_key_idx").on(
      t.orgType,
      t.orgId,
      t.kind,
      t.recordKey,
    ),
  }),
);
