import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { usersTable } from "./users";

// Per-vendor accounting-software connections used by the
// "Sync to QuickBooks" / "Sync to OpenAccountant" buttons on the
// Reports page. One row per (vendor, provider). Tokens are stored
// encrypted (AES-256-GCM); the DB only ever sees ciphertext.
//
// Provider semantics
//   "qbo" — QuickBooks Online, OAuth2. We persist access_token,
//           refresh_token, realm_id and the access-token expiry.
//   "oa"  — OpenAccountant. Their OAuth is not yet GA, so we
//           support manual API key entry; only access_token is
//           populated, refresh_token / expiry are NULL.
export const ACCOUNTING_PROVIDERS = ["qbo", "oa"] as const;
export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number];

export const ACCOUNTING_CONNECTION_STATUSES = [
  "active",
  "expired",
  "revoked",
] as const;
export type AccountingConnectionStatus =
  (typeof ACCOUNTING_CONNECTION_STATUSES)[number];

export const accountingConnectionsTable = pgTable(
  "accounting_connections",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // QBO realm (company) id — required for QBO API calls, NULL for OA.
    realmId: text("realm_id"),
    // Free-text label shown in the UI (e.g. "Acme Books — Production").
    displayName: text("display_name"),
    // Encrypted (AES-256-GCM) token blobs in `iv:authTag:ciphertext` hex form.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    // When the access token expires. NULL for OA (long-lived API key).
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    // Space-separated OAuth scopes granted at connect time.
    scopes: text("scopes"),
    status: text("status").notNull().default("active"),
    // Optional override for OA's API base URL (until OA publishes a stable
    // hostname). For QBO this is always Intuit's production API.
    apiBaseUrl: text("api_base_url"),
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
  },
  (t) => ({
    uniqVendorProvider: uniqueIndex("accounting_conn_vendor_provider_uniq").on(
      t.vendorId,
      t.provider,
    ),
    idxStatus: index("accounting_conn_status_idx").on(t.status),
  }),
);

export const insertAccountingConnectionSchema = createInsertSchema(
  accountingConnectionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountingConnection = z.infer<
  typeof insertAccountingConnectionSchema
>;
export type AccountingConnection =
  typeof accountingConnectionsTable.$inferSelect;
