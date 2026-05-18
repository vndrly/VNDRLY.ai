// Helpers around the accounting_connections table. Encapsulates token
// encryption / decryption so route code never touches plaintext blobs.

import { and, eq } from "drizzle-orm";
import {
  db,
  accountingConnectionsTable,
  accountingConnectionItemsTable,
  type AccountingConnection,
  type AccountingProvider,
  type AccountingConnectionStatus,
} from "@workspace/db";
import { encryptToken, tryDecryptToken } from "./crypto";

export interface DecryptedConnection {
  id: number;
  vendorId: number;
  provider: AccountingProvider;
  realmId: string | null;
  displayName: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  apiBaseUrl: string | null;
  status: AccountingConnectionStatus;
  scopes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toDecryptedConnection(
  row: AccountingConnection,
): DecryptedConnection {
  return {
    id: row.id,
    vendorId: row.vendorId,
    provider: row.provider as AccountingProvider,
    realmId: row.realmId,
    displayName: row.displayName,
    accessToken: tryDecryptToken(row.accessTokenEnc),
    refreshToken: tryDecryptToken(row.refreshTokenEnc),
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    apiBaseUrl: row.apiBaseUrl,
    status: row.status as AccountingConnectionStatus,
    scopes: row.scopes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface UpsertConnectionInput {
  vendorId: number;
  provider: AccountingProvider;
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  realmId?: string | null;
  displayName?: string | null;
  apiBaseUrl?: string | null;
  scopes?: string | null;
  createdByUserId?: number | null;
}

export async function upsertConnection(
  input: UpsertConnectionInput,
): Promise<AccountingConnection> {
  const accessTokenEnc = encryptToken(input.accessToken);
  const refreshTokenEnc =
    input.refreshToken != null ? encryptToken(input.refreshToken) : null;
  const now = new Date();

  // Use the unique (vendor, provider) index to do an INSERT … ON CONFLICT.
  const rows = await db
    .insert(accountingConnectionsTable)
    .values({
      vendorId: input.vendorId,
      provider: input.provider,
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      realmId: input.realmId ?? null,
      displayName: input.displayName ?? null,
      apiBaseUrl: input.apiBaseUrl ?? null,
      scopes: input.scopes ?? null,
      createdByUserId: input.createdByUserId ?? null,
      status: "active",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        accountingConnectionsTable.vendorId,
        accountingConnectionsTable.provider,
      ],
      set: {
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
        realmId: input.realmId ?? null,
        displayName: input.displayName ?? null,
        apiBaseUrl: input.apiBaseUrl ?? null,
        scopes: input.scopes ?? null,
        status: "active",
        updatedAt: now,
      },
    })
    .returning();

  return rows[0];
}

export async function getConnection(
  vendorId: number,
  provider: AccountingProvider,
): Promise<DecryptedConnection | null> {
  const rows = await db
    .select()
    .from(accountingConnectionsTable)
    .where(
      and(
        eq(accountingConnectionsTable.vendorId, vendorId),
        eq(accountingConnectionsTable.provider, provider),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return toDecryptedConnection(rows[0]);
}

export async function listConnectionsForVendor(
  vendorId: number,
): Promise<DecryptedConnection[]> {
  const rows = await db
    .select()
    .from(accountingConnectionsTable)
    .where(eq(accountingConnectionsTable.vendorId, vendorId));
  return rows.map(toDecryptedConnection);
}

export async function deleteConnection(
  id: number,
  vendorId: number,
): Promise<boolean> {
  const rows = await db
    .delete(accountingConnectionsTable)
    .where(
      and(
        eq(accountingConnectionsTable.id, id),
        eq(accountingConnectionsTable.vendorId, vendorId),
      ),
    )
    .returning({ id: accountingConnectionsTable.id });
  return rows.length > 0;
}

export async function updateAccessToken(
  id: number,
  accessToken: string,
  expiresAt: Date | null,
  refreshToken?: string | null,
): Promise<void> {
  const update: Record<string, unknown> = {
    accessTokenEnc: encryptToken(accessToken),
    accessTokenExpiresAt: expiresAt,
    updatedAt: new Date(),
    status: "active",
  };
  if (refreshToken !== undefined) {
    update.refreshTokenEnc =
      refreshToken === null ? null : encryptToken(refreshToken);
  }
  await db
    .update(accountingConnectionsTable)
    .set(update)
    .where(eq(accountingConnectionsTable.id, id));
}

export async function markRevoked(id: number): Promise<void> {
  await db
    .update(accountingConnectionsTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(accountingConnectionsTable.id, id));
}

/** Sanitized view safe to send back to the browser — never includes
 *  the decrypted access / refresh tokens. */
export interface PublicConnectionView {
  id: number;
  vendorId: number;
  provider: AccountingProvider;
  realmId: string | null;
  displayName: string | null;
  hasRefreshToken: boolean;
  accessTokenExpiresAt: string | null;
  status: AccountingConnectionStatus;
  apiBaseUrl: string | null;
  scopes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Per-connection Product/Service (Item) cache ────────────────────────
//
// One row per (connection, line_type) holding the QBO Item.Id (and the
// IncomeAccount.Id it points at, for cache invalidation). Used by
// `pushBundleToQbo` so we can send a real ItemRef per line instead of the
// placeholder `{ value: "1" }`.

export interface CachedConnectionItem {
  /** QBO Item.Id this VNDRLY line type maps to. */
  qboItemId: string;
  /** QBO Account.Id of the Item's IncomeAccountRef (if known). */
  qboAccountId: string | null;
  /** QbAccount.name we used the last time we resolved this row. */
  qboAccountName: string | null;
  /** When the cached row was last (re-)resolved. */
  updatedAt: Date;
}

/** Load the full {lineType -> {qboItemId, qboAccountId}} cache for a
 *  connection. Returns an empty object when nothing has been cached yet. */
export async function loadConnectionItemMap(
  connectionId: number,
): Promise<Record<string, CachedConnectionItem>> {
  const rows = await db
    .select({
      lineType: accountingConnectionItemsTable.lineType,
      qboItemId: accountingConnectionItemsTable.qboItemId,
      qboAccountId: accountingConnectionItemsTable.qboAccountId,
      qboAccountName: accountingConnectionItemsTable.qboAccountName,
      updatedAt: accountingConnectionItemsTable.updatedAt,
    })
    .from(accountingConnectionItemsTable)
    .where(eq(accountingConnectionItemsTable.connectionId, connectionId));
  const out: Record<string, CachedConnectionItem> = {};
  for (const r of rows) {
    out[r.lineType] = {
      qboItemId: r.qboItemId,
      qboAccountId: r.qboAccountId,
      qboAccountName: r.qboAccountName,
      updatedAt: r.updatedAt,
    };
  }
  return out;
}

/** Insert or update a single cache row. Uses the unique index on
 *  (connection_id, line_type) to upsert atomically. */
export async function upsertConnectionItem(input: {
  connectionId: number;
  lineType: string;
  qboItemId: string;
  qboAccountId: string | null;
  qboAccountName?: string | null;
}): Promise<void> {
  const now = new Date();
  const accountName = input.qboAccountName ?? null;
  await db
    .insert(accountingConnectionItemsTable)
    .values({
      connectionId: input.connectionId,
      lineType: input.lineType,
      qboItemId: input.qboItemId,
      qboAccountId: input.qboAccountId,
      qboAccountName: accountName,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        accountingConnectionItemsTable.connectionId,
        accountingConnectionItemsTable.lineType,
      ],
      set: {
        qboItemId: input.qboItemId,
        qboAccountId: input.qboAccountId,
        qboAccountName: accountName,
        updatedAt: now,
      },
    });
}

export function toPublicView(c: DecryptedConnection): PublicConnectionView {
  return {
    id: c.id,
    vendorId: c.vendorId,
    provider: c.provider,
    realmId: c.realmId,
    displayName: c.displayName,
    hasRefreshToken: c.refreshToken !== null,
    accessTokenExpiresAt: c.accessTokenExpiresAt
      ? c.accessTokenExpiresAt.toISOString()
      : null,
    status: c.status,
    apiBaseUrl: c.apiBaseUrl,
    scopes: c.scopes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
