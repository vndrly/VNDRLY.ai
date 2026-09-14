import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { managedSubcontractorOrganizationsTable } from "./managedSubcontractors";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";

export const accountInvitationsTable = pgTable(
  "account_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sponsorVendorId: integer("sponsor_vendor_id")
      .notNull()
      .references(() => vendorsTable.id),
    managedOrganizationId: uuid("managed_organization_id")
      .notNull()
      .references(() => managedSubcontractorOrganizationsTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    username: text("username").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    state: text("state").notNull().default("pending"),
    authorizationVersion: text("authorization_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryMessageId: text("delivery_message_id"),
    deliveryError: text("delivery_error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    issuedByUserId: integer("issued_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("account_invitations_token_hash_unique").on(table.tokenHash),
    sponsorLookup: index("account_invitations_sponsor_idx").on(
      table.sponsorVendorId,
      table.state,
    ),
    userLookup: index("account_invitations_user_idx").on(table.userId, table.state),
    stateCheck: check(
      "account_invitations_state_check",
      sql`${table.state} in ('pending', 'delivered', 'claimed', 'expired', 'revoked', 'delivery_failed')`,
    ),
  }),
);

export type AccountInvitation = typeof accountInvitationsTable.$inferSelect;
