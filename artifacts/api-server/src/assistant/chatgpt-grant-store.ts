import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { resolveContext } from "../routes/auth";
import type { SessionPayload } from "../lib/session";
import { AssistantOAuthError, type AssistantOAuthGrant } from "./chatgpt-oauth";

const CONTEXT_FIELDS = ["role", "membershipRole", "partnerId", "vendorId", "vendorRole", "vendorPeopleId", "activeMembershipId"] as const;
/** Re-resolve current database authority; a stored grant is never authority itself. */
export async function validateAssistantSession(session: SessionPayload, database: Omit<typeof db, "$client"> = db): Promise<SessionPayload> {
  if (!session.userId || !session.sv) throw new AssistantOAuthError("access_denied");
  const [user] = await database.select().from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  if (!user || user.suspendedAt || user.mustChangePassword || user.sessionVersion !== session.sv) throw new AssistantOAuthError("access_denied");
  const context = await resolveContext(user, database);
  if (!["admin", "vendor", "partner", "field_employee"].includes(context.role)) throw new AssistantOAuthError("access_denied");
  if (CONTEXT_FIELDS.some((field) => (session[field] ?? null) !== (context[field] ?? null)) ||
      JSON.stringify(session.managedSubcontractor ?? null) !== JSON.stringify(context.managedSubcontractor ?? null)) throw new AssistantOAuthError("access_denied");
  const now = Math.floor(Date.now() / 1000);
  return { ...session, displayName: user.displayName, iat: now, exp: now + 60 };
}

/** Secrets stay outside the ordinary Drizzle user projection to prevent accidental API serialization.
 * The additive migration provisions this dedicated column. All writes lock the owner row.
 */
export async function withAssistantGrants<T>(userId: number, operation: (grants: AssistantOAuthGrant[], database: Omit<typeof db, "$client">) => Promise<T>, connectionPool: typeof pool = pool): Promise<T> {
  const client = await connectionPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ assistant_oauth_grants: AssistantOAuthGrant[] | null }>(
      "SELECT assistant_oauth_grants FROM users WHERE id = $1 FOR UPDATE", [userId],
    );
    if (!result.rows[0]) throw new AssistantOAuthError("invalid_grant");
    const grants = result.rows[0].assistant_oauth_grants ?? [];
    if (!Array.isArray(grants)) throw new Error("Invalid assistant grant storage");
    let output: T | undefined;
    let failure: unknown;
    try { output = await operation(grants, drizzle(client, { schema })); } catch (error) { failure = error; }
    // Commit replay revocations even when the OAuth exchange rejects the request.
    await client.query("UPDATE users SET assistant_oauth_grants = $2::jsonb WHERE id = $1", [userId, JSON.stringify(grants)]);
    await client.query("COMMIT");
    if (failure) throw failure;
    return output as T;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
