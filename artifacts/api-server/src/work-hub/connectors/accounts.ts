import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import {
  db,
  workHubCalendarConnectionsTable as accounts,
  workHubSyncCursorsTable as operations,
} from "@workspace/db";
import { encryptConnection as encryptToken, decryptConnection as decryptToken } from "./crypto";
import { validateAssistantSession } from "../../assistant/chatgpt-grant-store";
import {
  teamsConnectionIdentity,
  type TeamsSession,
} from "../teams-connection-service";
import {
  authorization,
  config,
  ConnectorError,
  exchange,
  profile,
  randomId,
  scopes,
  type Provider,
  type Tokens,
} from "./providers";
type Row = typeof accounts.$inferSelect;
type Envelope = {
  provider: Provider;
  binding: ReturnType<typeof teamsConnectionIdentity>["binding"];
  label?: string;
  externalId?: string;
  tokens?: Tokens;
  session?: TeamsSession;
  stateHash?: string;
  verifier?: string;
  expires?: number;
  error?: string;
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function identity(s: TeamsSession) {
  const { binding } = teamsConnectionIdentity(s);
  return { binding, prefix: `comms:${s.userId}:${s.activeMembershipId ?? 0}:` };
}
function owned(s: TeamsSession) {
  const { binding, prefix } = identity(s);
  return and(
    eq(accounts.createdById, s.userId),
    eq(accounts.ownerOrgType, binding.ownerType),
    eq(accounts.ownerOrgId, binding.ownerId),
    like(accounts.provider, `${prefix}%`),
  );
}
function read(row: Row): Envelope {
  try {
    return JSON.parse(decryptToken(row.encryptedCredentials));
  } catch {
    throw new ConnectorError("reconnect_required", 409);
  }
}
export function assertBinding(s: TeamsSession, value: Envelope) {
  const b = identity(s).binding;
  if (
    Object.keys(b).some(
      (k) => b[k as keyof typeof b] !== value.binding?.[k as keyof typeof b],
    )
  )
    throw new ConnectorError("reconnect_required", 409);
}
export async function listAccounts(s: TeamsSession) {
  const rows = await db.select().from(accounts).where(owned(s));
  return rows
    .filter((r) => ["connected", "reconnect_required"].includes(r.status))
    .map((r) => {
      let value: Envelope;
      try { value = read(r); } catch {
        // A damaged/legacy grant must not hide every other provider account.
        return { id: r.id, provider: "unavailable", label: "Connection needs reconnecting", status: "reconnect_required" };
      }
      let status = r.status;
      try {
        assertBinding(s, value);
      } catch {
        status = "reconnect_required";
      }
      return { id: r.id, provider: value.provider, label: value.label, status };
    });
}
export function configurations() {
  return Object.fromEntries(
    (["outlook", "gmail", "teams", "slack"] as Provider[]).map((p) => {
      try {
        config(p);
        return [p, true];
      } catch {
        return [p, false];
      }
    }),
  );
}
export async function start(s: TeamsSession, provider: Provider) {
  config(provider);
  const { binding, prefix } = identity(s),
    id = randomUUID(),
    nonce = randomId(),
    verifier = randomId();
  const state = `${id}.${nonce}`;
  const value: Envelope = {
    provider,
    binding,
    session: s,
    stateHash: digest(state),
    verifier,
    expires: Date.now() + 600000,
  };
  await db.insert(accounts).values({
    id,
    ownerOrgType: binding.ownerType,
    ownerOrgId: binding.ownerId,
    createdById: s.userId,
    provider: `${prefix}pending:${id}`,
    capabilities: scopes[provider],
    status: "pending",
    encryptedCredentials: encryptToken(JSON.stringify(value)),
  });
  return { id, authorizationUrl: authorization(provider, state, verifier) };
}
export async function progress(s: TeamsSession, id: string) {
  const [r] = await db
    .select()
    .from(accounts)
    .where(and(owned(s), eq(accounts.id, id)))
    .limit(1);
  if (!r) throw new ConnectorError("connection_not_found", 404);
  const v = read(r);
  assertBinding(s, v);
  return { status: r.status, error: v.error, label: v.label };
}
/** The unpredictable, single-use state links browser consent to the initiating authenticated user on web or native. */
export async function finish(provider: Provider, state: string, code?: string) {
  if (!/^[a-f0-9-]{36}\.[\w-]{43}$/.test(state))
    throw new ConnectorError("invalid_oauth_state", 400);
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, state.split(".")[0]))
    .limit(1);
  if (!row || row.status !== "pending")
    throw new ConnectorError("invalid_oauth_state", 400);
  const v = read(row);
  if (
    v.provider !== provider ||
    !v.stateHash ||
    !timingSafeEqual(Buffer.from(v.stateHash), Buffer.from(digest(state))) ||
    !v.expires ||
    v.expires < Date.now() ||
    !v.session ||
    !v.verifier
  )
    throw new ConnectorError("invalid_oauth_state", 400);
  const current = await validateAssistantSession(v.session);
  assertBinding({ ...current, userId: v.session.userId }, v);
  const claimed = await db
    .update(accounts)
    .set({ status: "exchanging" })
    .where(and(eq(accounts.id, row.id), eq(accounts.status, "pending")))
    .returning({ id: accounts.id });
  if (!claimed.length) throw new ConnectorError("invalid_oauth_state", 400);
  try {
    if (!code) throw new ConnectorError("consent_not_completed", 400);
    const tokens = await exchange(provider, { code, verifier: v.verifier });
    const p = await profile(provider, tokens.access);
    if (!p.id || !p.label || (provider !== "slack" && !tokens.refresh))
      throw new ConnectorError("provider_invalid_identity");
    const stored: Envelope = {
      provider,
      binding: v.binding,
      tokens,
      externalId: p.id,
      label: p.label,
    };
    // A fresh record per account; reconnecting the same provider principal retires the prior local grant.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${identity(v.session!).prefix}:${provider}:${p.id}`}))`,
      );
      const old = await tx.select().from(accounts).where(owned(v.session!));
      for (const r of old) {
        if (r.id === row.id || r.status !== "connected") continue;
        let prior: Envelope;
        try { prior = read(r); } catch { continue; }
        if (prior.provider === provider && prior.externalId === p.id)
          await tx
            .update(accounts)
            .set({
              status: "revoked",
              revokedAt: new Date(),
              encryptedCredentials: encryptToken(
                JSON.stringify({ ...prior, tokens: undefined }),
              ),
            })
            .where(eq(accounts.id, r.id));
      }
      await tx
        .update(accounts)
        .set({
          status: "connected",
          encryptedCredentials: encryptToken(JSON.stringify(stored)),
        })
        .where(eq(accounts.id, row.id));
    });
  } catch (e) {
    await db
      .update(accounts)
      .set({
        status: "failed",
        encryptedCredentials: encryptToken(
          JSON.stringify({
            provider,
            binding: v.binding,
            error: e instanceof ConnectorError ? e.code : "connection_failed",
          }),
        ),
      })
      .where(eq(accounts.id, row.id));
    throw e;
  }
}
export async function disconnect(s: TeamsSession, id: string) {
  const [r] = await db
    .select()
    .from(accounts)
    .where(and(owned(s), eq(accounts.id, id)))
    .limit(1);
  if (!r) throw new ConnectorError("connection_not_found", 404);
  const v = read(r);
  await db
    .update(accounts)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      encryptedCredentials: encryptToken(
        JSON.stringify({
          provider: v.provider,
          binding: v.binding,
          externalId: v.externalId,
          label: v.label,
        }),
      ),
    })
    .where(and(owned(s), eq(accounts.id, id)));
  return { disconnected: true };
}
export async function withAccount<T>(
  s: TeamsSession,
  id: string,
  action: (provider: Provider, token: string, label: string) => Promise<T>,
): Promise<T> {
  // Ordinary reads need no transaction or refresh lock. Still check ownership,
  // revocation and session binding on every request before using the grant.
  const [current] = await db.select().from(accounts).where(and(owned(s), eq(accounts.id, id))).limit(1);
  if (!current || current.status !== "connected" || current.revokedAt)
    throw new ConnectorError("reconnect_required", 409);
  const ready = read(current);
  assertBinding(s, ready);
  if (!ready.tokens) throw new ConnectorError("reconnect_required", 409);
  if (ready.tokens.expires >= Date.now() + 60000)
    return action(ready.provider, ready.tokens.access, ready.label!);
  const value = await db.transaction(async (tx) => {
    // Serialize refresh-token rotation across API processes; never overwrite a newer grant or disconnect.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    const [row] = await tx
      .select()
      .from(accounts)
      .where(and(owned(s), eq(accounts.id, id)))
      .limit(1)
      .for("update");
    if (!row || row.status !== "connected" || row.revokedAt)
      throw new ConnectorError("reconnect_required", 409);
    const v = read(row);
    assertBinding(s, v);
    if (!v.tokens) throw new ConnectorError("reconnect_required", 409);
    if (v.tokens.expires < Date.now() + 60000) {
      if (!v.tokens.refresh)
        throw new ConnectorError("reconnect_required", 409);
      v.tokens = await exchange(v.provider, { refresh: v.tokens.refresh });
      await tx
        .update(accounts)
        .set({ encryptedCredentials: encryptToken(JSON.stringify(v)) })
        .where(
          and(
            eq(accounts.id, id),
            eq(accounts.status, "connected"),
            eq(accounts.encryptedCredentials, row.encryptedCredentials),
          ),
        );
    }
    return v;
  });
  return action(value.provider, value.tokens!.access, value.label!);
}
export async function once<T>(
  s: TeamsSession,
  id: string,
  operationId: string,
  payload: unknown,
  action: () => Promise<T>,
): Promise<T> {
  await progress(s, id);
  const resourceType = `comms-operation:${operationId}`,
    fingerprint = digest(JSON.stringify(payload));
  const inserted = await db
    .insert(operations)
    .values({
      connectionId: id,
      resourceType,
      cursor: JSON.stringify({ fingerprint, pending: true }),
    })
    .onConflictDoNothing()
    .returning({ id: operations.id });
  if (!inserted.length) {
    const [r] = await db
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.connectionId, id),
          eq(operations.resourceType, resourceType),
        ),
      )
      .limit(1);
    const old = JSON.parse(r?.cursor || "{}");
    if (old.fingerprint !== fingerprint)
      throw new ConnectorError("operation_conflict", 409);
    if (old.pending)
      throw new ConnectorError(
        "delivery_unconfirmed_check_sent_before_retrying",
        409,
      );
    return old.result as T;
  }
  const result = await action();
  await db
    .update(operations)
    .set({
      cursor: JSON.stringify({ fingerprint, result }),
      lastSuccessAt: new Date(),
    })
    .where(eq(operations.id, inserted[0].id));
  return result;
}
