import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { siteLocationsTable } from "./siteLocations";
import { usersTable } from "./users";
const time = (name: string) => timestamp(name, { withTimezone: true });

export const gateStationsTable = pgTable(
  "gate_stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: integer("site_id")
      .notNull()
      .references(() => siteLocationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: uniqueIndex("gate_stations_site_name_unique").on(
      t.siteId,
      t.name,
    ),
  }),
);

export const gateShiftsTable = pgTable(
  "gate_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => gateStationsTable.id),
    operatorId: integer("operator_id")
      .notNull()
      .references(() => usersTable.id),
    startedAt: time("started_at").notNull().defaultNow(),
    endedAt: time("ended_at"),
    preparationId: uuid("preparation_id"),
  },
  (t) => ({
    activeUnique: uniqueIndex("gate_shifts_active_unique")
      .on(t.stationId)
      .where(sql`${t.endedAt} IS NULL`),
  }),
);

export const gatePreparationsTable = pgTable(
  "gate_preparations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => gateShiftsTable.id),
    preparedBy: integer("prepared_by")
      .notNull()
      .references(() => usersTable.id),
    snapshot: jsonb("snapshot").notNull(),
    notes: text("notes").notNull(),
    summary: jsonb("summary").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => ({
    shiftIdx: index("gate_preparations_shift_idx").on(t.shiftId, t.createdAt),
  }),
);

export const gateHandoversTable = pgTable(
  "gate_handovers",
  {
    id: uuid("id").primaryKey(),
    preparationId: uuid("preparation_id")
      .notNull()
      .unique()
      .references(() => gatePreparationsTable.id),
    incomingShiftId: uuid("incoming_shift_id")
      .notNull()
      .references(() => gateShiftsTable.id),
    incomingUserId: integer("incoming_user_id")
      .notNull()
      .references(() => usersTable.id),
    outgoingName: text("outgoing_name").notNull(),
    incomingName: text("incoming_name").notNull(),
    acknowledgedAt: time("acknowledged_at").notNull().defaultNow(),
  },
  (t) => ({
    recentIdx: index("gate_handovers_recent_idx").on(t.acknowledgedAt, t.id),
  }),
);

// Append-only operational events. The newest event for an item defines its
// current state; old handoff snapshots retain the state reviewed at transfer.
export const gateShiftActionsTable = pgTable(
  "gate_shift_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => gateStationsTable.id),
    actorId: integer("actor_id")
      .notNull()
      .references(() => usersTable.id),
    itemId: uuid("item_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index("gate_shift_actions_item_idx").on(
      t.stationId,
      t.itemId,
      t.createdAt,
    ),
  }),
);
