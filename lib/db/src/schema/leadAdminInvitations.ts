import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const leadAdminInvitationsTable = pgTable("lead_admin_invitations", {
  tokenHash: text("token_hash").primaryKey(),
  orgType: text("org_type").notNull(),
  orgId: integer("org_id").notNull(),
  invitedBy: integer("invited_by").notNull().references(() => usersTable.id),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  makeOwner: boolean("make_owner").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});
