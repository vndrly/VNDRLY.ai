import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
export const workHubSchedulingTypesTable = pgTable(
  "work_hub_scheduling_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerOrgType: text("owner_org_type").notNull(),
    ownerOrgId: integer("owner_org_id").notNull(),
    hostUserId: integer("host_user_id")
      .notNull()
      .references(() => usersTable.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    durationMinutes: integer("duration_minutes").notNull(),
    timezone: text("timezone").notNull(),
    visibility: text("visibility").notNull().default("personal"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("work_hub_scheduling_types_owner_idx").on(
      t.ownerOrgType,
      t.ownerOrgId,
    ),
  }),
);
export const workHubSchedulingAvailabilityTable = pgTable(
  "work_hub_scheduling_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => workHubSchedulingTypesTable.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    typeIdx: index("work_hub_scheduling_availability_type_idx").on(
      t.typeId,
      t.startsAt,
    ),
  }),
);
