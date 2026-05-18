import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { DEMO_USERS } from "./demo-users";
import { logger } from "./logger";

/**
 * Dev-only startup self-check: warn if any seeded demo username exists
 * with a bcrypt hash that does NOT verify against the canonical password
 * declared in `DEMO_USERS`. This catches the failure mode from Task #739
 * where a SQL import (or a manual change) leaves a stale hash behind, so
 * `admin/admin123`, `exxon/exxon123`, etc. silently 401 on every login
 * attempt and there is no in-product signal of why.
 *
 * The check is read-only — it logs a one-line warning per drifted demo
 * user and a single "how to recover" hint. Nothing is rewritten on boot;
 * recovery happens by calling `POST /api/auth/seed`, which idempotently
 * re-hashes drifted demo passwords back to the canonical value.
 */
export async function verifyDemoPasswords(): Promise<void> {
  try {
    const usernames = DEMO_USERS.map((u) => u.username.toLowerCase());
    if (usernames.length === 0) return;

    const rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        passwordHash: usersTable.passwordHash,
      })
      .from(usersTable)
      .where(inArray(sql`lower(${usersTable.username})`, usernames));

    const byName = new Map(
      rows.map((r) => [r.username.toLowerCase(), r] as const),
    );

    const drifted: string[] = [];
    for (const demo of DEMO_USERS) {
      const row = byName.get(demo.username.toLowerCase());
      if (!row) continue; // not seeded yet — /auth/seed will create it
      const ok = bcrypt.compareSync(demo.password, row.passwordHash);
      if (!ok) drifted.push(demo.username);
    }

    if (drifted.length === 0) return;

    logger.warn(
      { drifted },
      "verifyDemoPasswords: demo logins have stale password hashes — POST /api/auth/seed to restore them",
    );
  } catch (err) {
    // Self-check is best-effort. Never let a DB hiccup take down boot.
    logger.error({ err }, "verifyDemoPasswords: self-check failed");
  }
}
