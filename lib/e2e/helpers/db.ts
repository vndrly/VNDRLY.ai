import bcrypt from "bcryptjs";
import pg from "pg";

// Shared database setup utilities for every Playwright spec under
// lib/e2e/tests/.
//
// Every spec used to carry its own copy of these primitives — a
// `pg.Pool` opened from `process.env.DATABASE_URL`, a
// `bcrypt.hashSync(..., 10)` for test passwords, and a `Date.now()`
// based "stamp" for namespacing fixture rows so re-runs on a shared
// dev / CI database don't collide. Centralising them here means the
// next time we change the bcrypt cost factor, the env var name, or
// the stamp shape we fix it in exactly one place instead of N.

/**
 * Open a `pg.Pool` against the same database the api-server is
 * pointed at. Throws a clear error when `DATABASE_URL` isn't set so
 * the test fails loudly during `beforeAll` instead of leaking a
 * confusing pg connection error from the first query.
 */
export function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to run this e2e test (it must point at the same database the api-server is using)",
    );
  }
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

/**
 * Hash a plain-text password the same way the api-server does for
 * seeded test logins. Centralised so the cost factor stays in sync
 * with the production code path.
 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

/**
 * Per-run stamp suitable for namespacing fixture rows so re-runs
 * against a shared dev / CI database don't collide. Combines a
 * base-36 timestamp with a short random suffix so two parallel
 * shards still get distinct stamps even when their `Date.now()`
 * collides at millisecond resolution.
 */
export function makeStamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
