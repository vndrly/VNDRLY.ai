import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const majikCirclesTable = pgTable("majik_circles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  maxMembers: integer("max_members").notNull().default(8),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const majikCircleMembersTable = pgTable(
  "majik_circle_members",
  {
    circleId: integer("circle_id")
      .notNull()
      .references(() => majikCirclesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.circleId, t.userId] }),
    userUnique: uniqueIndex("majik_circle_members_user_uniq").on(t.userId),
  }),
);

export const majikPresenceTable = pgTable(
  "majik_presence",
  {
    circleId: integer("circle_id")
      .notNull()
      .references(() => majikCirclesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    isUp: boolean("is_up").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.circleId, t.userId] }),
  }),
);

export const insertMajikCircleSchema = createInsertSchema(majikCirclesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMajikCircle = z.infer<typeof insertMajikCircleSchema>;
export type MajikCircle = typeof majikCirclesTable.$inferSelect;

export const insertMajikCircleMemberSchema = createInsertSchema(majikCircleMembersTable).omit({
  addedAt: true,
});
export type InsertMajikCircleMember = z.infer<typeof insertMajikCircleMemberSchema>;
export type MajikCircleMember = typeof majikCircleMembersTable.$inferSelect;

export const insertMajikPresenceSchema = createInsertSchema(majikPresenceTable).omit({
  updatedAt: true,
});
export type InsertMajikPresence = z.infer<typeof insertMajikPresenceSchema>;
export type MajikPresence = typeof majikPresenceTable.$inferSelect;
