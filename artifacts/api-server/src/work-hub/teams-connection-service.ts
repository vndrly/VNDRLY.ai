import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, like, notLike } from "drizzle-orm";
import { db, workHubCalendarConnectionsTable as connections, workHubSyncCursorsTable as cursors } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { encryptToken, decryptToken } from "../lib/accounting/crypto";
import { authorizationUrl, exchangeTeamsCode, refreshTeamsToken, getTeamsProfile, loadTeamsConfig, TEAMS_SCOPES, TeamsProviderError, type TeamsTokens } from "./teams-graph";

export type TeamsSession = SessionPayload & { userId: number };
type Connection = typeof connections.$inferSelect;
type Profile = Awaited<ReturnType<typeof getTeamsProfile>> & { username: string };
type Binding = { userId: number; membershipId: number; sessionVersion: number; ownerType: "vendor" | "partner"; ownerId: number };
type Credentials = { kind: "teams_connection_v1"; binding: Binding; tokens?: TeamsTokens; expiresAt?: number; account?: Profile; tenantId?: string; generation: string };
type Pending = { kind: "teams_oauth_v1"; binding: Binding; verifier: string; expiresAt: number; priorCredentials: string };

/** Identity is derived only from the authenticated active organization, never request parameters. */
export function teamsConnectionIdentity(session: TeamsSession) {
  if (!Number.isInteger(session.userId) || session.userId <= 0 || session.realm === "demo" || session.publicDemo || session.managedSubcontractor) throw new TeamsProviderError("teams_connection_forbidden", 403);
  const ownerType = session.vendorId ? "vendor" : session.partnerId ? "partner" : null;
  const ownerId = session.vendorId || session.partnerId;
  if (!ownerType || !ownerId || !Number.isInteger(ownerId) || ownerId <= 0 || (session.vendorId && session.partnerId)) throw new TeamsProviderError("teams_organization_required", 403);
  const binding: Binding = { userId: session.userId, membershipId: session.activeMembershipId ?? 0, sessionVersion: session.sv ?? 1, ownerType, ownerId };
  return { binding, provider: `microsoft_teams:${session.userId}:${session.activeMembershipId ?? 0}` };
}
function sameBinding(a: Binding, b: Binding) {
  return a && a.userId === b.userId && a.membershipId === b.membershipId && a.sessionVersion === b.sessionVersion && a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}
function assertGrantedScopes(tokens: TeamsTokens) {
  const granted = new Set(tokens.scope.split(/\s+/).map(scope => scope.toLowerCase()));
  if (TEAMS_SCOPES.filter(scope => scope.includes(".")).some(scope => !granted.has(scope.toLowerCase()))) throw new TeamsProviderError("teams_permissions_required", 403);
}
function readCredentials(row: Connection, binding: Binding): Credentials {
  let data: Credentials;
  try { data = JSON.parse(decryptToken(row.encryptedCredentials)) as Credentials; }
  catch { throw new TeamsProviderError("teams_reconnect_required", 401); }
  if (data.kind !== "teams_connection_v1" || !sameBinding(data.binding, binding)) throw new TeamsProviderError("teams_reconnect_required", 401);
  return data;
}
function ownerPredicate(identity: ReturnType<typeof teamsConnectionIdentity>) {
  return and(eq(connections.ownerOrgType, identity.binding.ownerType), eq(connections.ownerOrgId, identity.binding.ownerId), eq(connections.provider, identity.provider), eq(connections.createdById, identity.binding.userId));
}
async function findConnection(session: TeamsSession) {
  const identity = teamsConnectionIdentity(session);
  const [row] = await db.select().from(connections).where(ownerPredicate(identity)).limit(1);
  return { identity, row };
}
export async function getTeamsConnection(session: TeamsSession): Promise<Connection | null> {
  const { identity, row } = await findConnection(session);
  if (!row || row.status !== "connected" || row.revokedAt) return null;
  const credentials = readCredentials(row, identity.binding);
  if (!credentials.tokens?.accessToken || !credentials.account?.id || !credentials.tenantId) return null;
  assertGrantedScopes(credentials.tokens);
  return row;
}
export async function status(session: TeamsSession) {
  const configured = Boolean(loadTeamsConfig());
  try {
    const row = await getTeamsConnection(session);
    if (!row) return { configured, connected: false };
    const credentials = readCredentials(row, teamsConnectionIdentity(session).binding);
    return { configured, connected: true, account: credentials.account, accountGeneration: credentials.generation };
  } catch (error) {
    if (error instanceof TeamsProviderError && error.code === "teams_reconnect_required") return { configured, connected: false, reconnectRequired: true };
    throw error;
  }
}
/** Bind a mutation to the Microsoft account the user actually reviewed in their current UI. */
export function assertTeamsGeneration(session: TeamsSession, row: Connection, expectedGeneration: string): void {
  const identity = teamsConnectionIdentity(session);
  const credentials = readCredentials(row, identity.binding);
  if (row.status !== "connected" || row.revokedAt || row.createdById !== session.userId || row.ownerOrgType !== identity.binding.ownerType || row.ownerOrgId !== identity.binding.ownerId || row.provider !== identity.provider || !/^[a-f0-9]{64}$/i.test(expectedGeneration) || !/^[a-f0-9]{64}$/i.test(credentials.generation) || !timingSafeEqual(Buffer.from(expectedGeneration, "hex"), Buffer.from(credentials.generation, "hex"))) throw new TeamsProviderError("teams_account_changed", 409);
}
export async function connectStart(session: TeamsSession): Promise<{ authorizationUrl: string }> {
  const config = loadTeamsConfig(); if (!config) throw new TeamsProviderError("teams_registration_required", 503);
  const identity = teamsConnectionIdentity(session);
  const placeholder = encryptToken(JSON.stringify({ kind: "teams_connection_v1", binding: identity.binding, generation: randomBytes(16).toString("hex") } satisfies Credentials));
  await db.insert(connections).values({ ownerOrgType: identity.binding.ownerType, ownerOrgId: identity.binding.ownerId, provider: identity.provider, createdById: session.userId, capabilities: [], status: "pending", encryptedCredentials: placeholder }).onConflictDoNothing();
  const { row } = await findConnection(session); if (!row) throw new TeamsProviderError("teams_connection_unavailable", 409);
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const pending: Pending = { kind: "teams_oauth_v1", binding: identity.binding, verifier, expiresAt: Date.now() + 10 * 60000, priorCredentials: row.encryptedCredentials };
  await db.insert(cursors).values({ connectionId: row.id, resourceType: `oauth:${stateHash}`, cursor: encryptToken(JSON.stringify(pending)) }).onConflictDoNothing();
  return { authorizationUrl: authorizationUrl(config, { state, codeChallenge: createHash("sha256").update(verifier).digest("base64url") }) };
}
export async function finishConnect(session: TeamsSession, state: string, code: string): Promise<{ connected: true; account: Profile }> {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(state) || !code || code.length > 10000) throw new TeamsProviderError("teams_invalid_oauth_state", 400);
  const config = loadTeamsConfig(); if (!config) throw new TeamsProviderError("teams_registration_required", 503);
  const { identity, row } = await findConnection(session); if (!row) throw new TeamsProviderError("teams_invalid_oauth_state", 400);
  const resourceType = `oauth:${createHash("sha256").update(state).digest("hex")}`;
  const [cursor] = await db.select().from(cursors).where(and(eq(cursors.connectionId, row.id), eq(cursors.resourceType, resourceType))).limit(1);
  let pending: Pending;
  try { pending = JSON.parse(decryptToken(cursor?.cursor || "")) as Pending; } catch { throw new TeamsProviderError("teams_invalid_oauth_state", 400); }
  if (pending.kind !== "teams_oauth_v1" || pending.expiresAt <= Date.now() || !sameBinding(pending.binding, identity.binding) || pending.priorCredentials !== row.encryptedCredentials) throw new TeamsProviderError("teams_invalid_oauth_state", 400);
  // Consume before contacting Microsoft. A failed exchange requires a fresh authorization; replay cannot exchange twice.
  const claimed = await db.update(cursors).set({ cursor: null, updatedAt: new Date() }).where(and(eq(cursors.id, cursor.id), eq(cursors.cursor, cursor.cursor!))).returning({ id: cursors.id });
  if (!claimed.length) throw new TeamsProviderError("teams_invalid_oauth_state", 400);
  const tokens = await exchangeTeamsCode(config, code, pending.verifier);
  assertGrantedScopes(tokens);
  const principal = await getTeamsProfile(tokens.accessToken);
  const account = { ...principal, username: principal.userPrincipalName || principal.mail || "" };
  if (!account.id || !account.userPrincipalName || !tokens.refreshToken || !tokens.tenantId) throw new TeamsProviderError("provider_invalid_identity", 502);
  let prior: Credentials | undefined;
  // A session-version change requires reconnect but must still retain the previous Microsoft principal boundary.
  try { prior = JSON.parse(decryptToken(pending.priorCredentials)) as Credentials; } catch { /* Initial registration has no principal. */ }
  const accountChanged = Boolean(prior?.account?.id && (prior.account.id !== account.id || prior.tenantId !== tokens.tenantId));
  if (accountChanged && row.status !== "revoked") throw new TeamsProviderError("teams_disconnect_before_account_switch", 409);
  const credentials: Credentials = { kind: "teams_connection_v1", binding: identity.binding, tokens, expiresAt: Date.now() + tokens.expiresIn * 1000, account, tenantId: tokens.tenantId, generation: createHash("sha256").update(`${tokens.tenantId}:${account.id}`).digest("hex") };
  await db.transaction(async tx => {
    const updated = await tx.update(connections).set({ status: "connected", revokedAt: null, capabilities: [...TEAMS_SCOPES], encryptedCredentials: encryptToken(JSON.stringify(credentials)) }).where(and(ownerPredicate(identity), eq(connections.id, row.id), eq(connections.encryptedCredentials, pending.priorCredentials))).returning({ id: connections.id });
    if (!updated.length) throw new TeamsProviderError("teams_connection_changed", 409);
    // A deliberate principal switch cannot reuse another account's external event IDs or cached sync state.
    // Same-principal reconnects keep their mappings and therefore cannot duplicate previously linked meetings.
    if (accountChanged) await tx.update(cursors).set({ cursor: null, lastSuccessAt: null, lastErrorCode: "teams_account_changed", updatedAt: new Date() }).where(and(eq(cursors.connectionId, row.id), notLike(cursors.resourceType, "oauth:%")));
  });
  return { connected: true, account };
}
export async function disconnect(session: TeamsSession) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { identity, row } = await findConnection(session);
    if (!row) return { disconnected: true as const };
    // Rotating the local envelope invalidates in-flight OAuth callbacks and refresh compare-and-swap writes.
    let prior: Credentials | undefined;
    try { prior = JSON.parse(decryptToken(row.encryptedCredentials)) as Credentials; } catch { /* Revocation still succeeds for unreadable credentials. */ }
    const empty: Credentials = { kind: "teams_connection_v1", binding: identity.binding, account: prior?.account, tenantId: prior?.tenantId, generation: prior?.generation || randomBytes(16).toString("hex") };
    const changed = await db.update(connections).set({ status: "revoked", revokedAt: new Date(), encryptedCredentials: encryptToken(JSON.stringify(empty)) }).where(and(ownerPredicate(identity), eq(connections.id, row.id), eq(connections.encryptedCredentials, row.encryptedCredentials))).returning({ id: connections.id });
    if (!changed.length) continue;
    await db.update(cursors).set({ cursor: null, updatedAt: new Date() }).where(and(eq(cursors.connectionId, row.id), like(cursors.resourceType, "oauth:%")));
    return { disconnected: true as const };
  }
  throw new TeamsProviderError("teams_connection_changed", 409);
}
export async function withTeamsToken<T>(session: TeamsSession, callback: (token: string, connection: Connection) => Promise<T>): Promise<T> {
  const identity = teamsConnectionIdentity(session);
  let row = await getTeamsConnection(session); if (!row) throw new TeamsProviderError("teams_not_connected", 409);
  let credentials = readCredentials(row, identity.binding);
  if (!credentials.expiresAt || credentials.expiresAt <= Date.now() + 60000) {
    const config = loadTeamsConfig(); if (!config || !credentials.tokens?.refreshToken) throw new TeamsProviderError("teams_reconnect_required", 401);
    const refreshed = await refreshTeamsToken(config, credentials.tokens.refreshToken);
    assertGrantedScopes(refreshed);
    if (refreshed.tenantId && refreshed.tenantId !== credentials.tenantId) throw new TeamsProviderError("provider_identity_changed", 401);
    const next: Credentials = { ...credentials, tokens: refreshed, expiresAt: Date.now() + refreshed.expiresIn * 1000 };
    await db.update(connections).set({ encryptedCredentials: encryptToken(JSON.stringify(next)) }).where(and(ownerPredicate(identity), eq(connections.id, row.id), eq(connections.status, "connected"), isNull(connections.revokedAt), eq(connections.encryptedCredentials, row.encryptedCredentials))).returning({ id: connections.id });
    // A racing refresh uses the winner; a racing disconnect cannot be overwritten or used.
    row = await getTeamsConnection(session); if (!row) throw new TeamsProviderError("teams_not_connected", 409);
    credentials = readCredentials(row, identity.binding);
    if (!credentials.expiresAt || credentials.expiresAt <= Date.now() + 1000) throw new TeamsProviderError("teams_refresh_in_progress", 409);
  }
  return callback(credentials.tokens!.accessToken, row);
}
