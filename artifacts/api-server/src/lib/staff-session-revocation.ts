import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { SessionPayload } from "./session";

export const STAFF_SESSION_REVOCATION_SCHEMA = "ALTER TABLE users ADD COLUMN IF NOT EXISTS revoked_staff_sessions jsonb";
type Revocation = { hash: string; expiresAt: number };

function retainedRevocations(value: unknown, now: number): Revocation[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(entry => !entry || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isFinite(entry.expiresAt))) {
    throw new Error("Invalid staff session revocation storage");
  }
  return value.filter(entry => entry.expiresAt >= now);
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Only fingerprints are retained, never bearer credentials. Expired entries are pruned on logout. */
export function isStaffSessionRevoked(value: unknown, token: string, now = Date.now()): boolean {
  return retainedRevocations(value, now).some(entry => entry.hash === tokenHash(token));
}

export async function isStaffTokenRevoked(token: string, userId: number): Promise<boolean> {
  const result = await pool.query("SELECT revoked_staff_sessions FROM users WHERE id = $1", [userId]);
  return isStaffSessionRevoked(result.rows[0]?.revoked_staff_sessions, token);
}

/** Serialize concurrent logouts with grants/security changes using the same owner row lock. */
export async function revokeStaffSession(token: string, session: SessionPayload): Promise<void> {
  if (!session.userId || typeof session.exp !== "number" || typeof session.sv !== "number") throw new Error("Invalid staff session");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT session_version, revoked_staff_sessions FROM users WHERE id = $1 FOR UPDATE", [session.userId]);
    const row = result.rows[0];
    if (!row || row.session_version !== session.sv) throw new Error("Staff session invalidated");
    const entries = retainedRevocations(row.revoked_staff_sessions, Date.now());
    const hash = tokenHash(token);
    if (!entries.some(entry => entry.hash === hash)) {
      // Never evict an unexpired revocation to make room for another token.
      if (entries.length >= 4096) throw new Error("Staff session revocation capacity reached");
      entries.push({ hash, expiresAt: session.exp * 1000 });
    }
    await client.query("UPDATE users SET revoked_staff_sessions = $2::jsonb WHERE id = $1", [session.userId, JSON.stringify(entries)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
