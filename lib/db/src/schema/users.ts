import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userOrgMembershipsTable } from "./userOrgMemberships";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // Contact email for the login. For org-member, partner-contact, and
  // vendor-people-derived logins this mirrors `username` (which is the
  // email the admin entered when onboarding). For non-email logins
  // (system admins, demo accounts) this is null. The visitor-check-in
  // notifier helper joins `users.email` to `partner_contacts.email`,
  // so this column must stay populated whenever a real contact email
  // is known for the user.
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  // Last-active membership. Lambda + AnyPgColumn breaks the circular
  // import with userOrgMembershipsTable. SET NULL on delete falls back
  // to the user's first remaining membership at login.
  activeMembershipId: integer("active_membership_id").references(
    (): AnyPgColumn => userOrgMembershipsTable.id,
    { onDelete: "set null" },
  ),
  displayName: text("display_name").notNull(),
  preferredLanguage: text("preferred_language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Incremented on logout/membership-change to invalidate all previously-
  // issued session tokens. Embedded in session tokens as `sv`; any token
  // carrying a different version is rejected server-side.
  sessionVersion: integer("session_version").notNull().default(1),
  // When set, login is rejected and the user is treated as inactive.
  // Cleared by an admin via the Reactivate action.
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  // The user that suspended this account (for audit). Self-referential FK
  // expressed via lambda + AnyPgColumn to avoid circular declaration.
  suspendedBy: integer("suspended_by").references(
    (): AnyPgColumn => usersTable.id,
    { onDelete: "set null" },
  ),
  // True when an admin has set a temporary password and the user must
  // change it on their next successful login before doing anything else.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Set when the user clicks the verification link sent during
  // onboarding. Null means the email has never been confirmed. Used to
  // show a "Verify your email" banner during onboarding and as a
  // bot-prevention signal — completion is not gated on this so users
  // can keep working while the email arrives.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Single-use token issued at account creation (and via resend) that
  // verifies the user's email when clicked. Cleared on successful
  // verification. Long enough (24 random bytes hex) to be unguessable.
  emailVerifyToken: text("email_verify_token"),
  // Expiration for the current emailVerifyToken (24h from issuance).
  emailVerifyTokenExpiresAt: timestamp("email_verify_token_expires_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
