import { sql } from "drizzle-orm";
import { db, signupAssistantCountersTable } from "@workspace/db";
import type { BucketIncrementResult, BucketStore } from "./bucket-store";
import { logger } from "./logger";

// Postgres-backed `BucketStore` for the signup-assistant abuse
// controls. The signup-assistant counters used to live in process
// memory (or, when configured, in Redis via the shared
// `BucketStore`). Without Redis a deploy or crash reset the per-day
// circuit breaker to zero — momentarily widening the abuse window —
// and a second API replica started its own independent counters.
//
// This store backs both namespaces (`SIGNUP_ASSISTANT_IP` and
// `SIGNUP_ASSISTANT_DAILY`) by a single Postgres row per
// `(namespace, key)` pair. Atomicity comes from the composite primary
// key plus an `INSERT ... ON CONFLICT DO UPDATE` whose UPDATE branch
// reads the row's existing `reset_at` to decide whether the current
// hit extends the open window or starts a fresh one. Postgres
// serialises concurrent writers on the same row, so two replicas
// hitting the same IP at the same instant agree on the new count.
//
// Public surface mirrors `MemoryBucketStore` / `RedisBucketStore`
// exactly so callers (`signup-assistant-rate-limit.ts`) cannot tell
// which backend is in use, and the existing test contract that
// injects a `MemoryBucketStore` keeps working unchanged.

// Approximate cadence of the opportunistic sweep that prunes rows
// whose window has already elapsed. Keeps the table small without
// requiring a separate cron — every increment checks the wall clock
// and runs the sweep at most once per process per hour. Cheap when
// the table is small (which it is, by design).
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export class PostgresBucketStore implements BucketStore {
  // Last sweep timestamp tracked per-instance (which in practice is
  // per-process, since the singleton lives in
  // `signup-assistant-rate-limit.ts`). A negative initial value
  // forces a sweep on the very first increment after boot, which is
  // when stale rows from the previous process generation are most
  // likely to be present.
  private lastSweepAt = -Infinity;

  async increment(
    namespace: string,
    key: string,
    windowMs: number,
    now: number,
  ): Promise<BucketIncrementResult> {
    // Atomic upsert. The UPDATE branch reads the row's existing
    // `reset_at` and either:
    //   - extends the open window: `count := count + 1`, `reset_at`
    //     unchanged. This is the fixed-window contract — the window
    //     tracks the FIRST hit, not the last, matching the in-memory
    //     and Redis stores.
    //   - opens a fresh window: `count := 1`, `reset_at := now + windowMs`.
    //     Triggered when the previous window has already elapsed at
    //     `now`, which is how UTC-midnight rollover works for the
    //     daily bucket (the day-key changes anyway, but if a stale
    //     bucket somehow shares a key we still recover cleanly).
    //
    // `now` and `reset_at` come from the caller in milliseconds since
    // the epoch and are converted to `timestamptz` via
    // `to_timestamp($n / 1000.0)` so the Postgres clock never drifts
    // the bucket boundaries away from what `Date.now()` reports on
    // the API server.
    const nowSec = now / 1000;
    const resetSec = (now + windowMs) / 1000;
    const result = await db.execute<{ count: number; reset_at_ms: string }>(sql`
      INSERT INTO ${signupAssistantCountersTable}
        (namespace, key, count, reset_at, updated_at)
      VALUES
        (${namespace}, ${key}, 1, to_timestamp(${resetSec}), to_timestamp(${nowSec}))
      ON CONFLICT (namespace, key) DO UPDATE SET
        count = CASE
          WHEN ${signupAssistantCountersTable.resetAt} > to_timestamp(${nowSec})
            THEN ${signupAssistantCountersTable.count} + 1
          ELSE 1
        END,
        reset_at = CASE
          WHEN ${signupAssistantCountersTable.resetAt} > to_timestamp(${nowSec})
            THEN ${signupAssistantCountersTable.resetAt}
          ELSE to_timestamp(${resetSec})
        END,
        updated_at = to_timestamp(${nowSec})
      RETURNING
        count,
        (EXTRACT(EPOCH FROM reset_at) * 1000)::bigint::text AS reset_at_ms
    `);
    const row = result.rows?.[0];
    if (!row) {
      // Shouldn't happen — the upsert always returns one row — but
      // defaulting to a single-hit window keeps the limiter
      // functional rather than hard-crashing the assistant route on
      // a transient driver oddity.
      return { count: 1, resetAt: now + windowMs };
    }
    void this.maybeSweep(now);
    return {
      count: Number(row.count),
      // `reset_at_ms` comes back as a numeric string because Postgres
      // returns BIGINT as text by default; coerce to JS number.
      resetAt: Number(row.reset_at_ms),
    };
  }

  async peek(
    namespace: string,
    key: string,
    now: number,
  ): Promise<BucketIncrementResult | null> {
    const nowSec = now / 1000;
    const result = await db.execute<{ count: number; reset_at_ms: string }>(sql`
      SELECT
        count,
        (EXTRACT(EPOCH FROM reset_at) * 1000)::bigint::text AS reset_at_ms
      FROM ${signupAssistantCountersTable}
      WHERE namespace = ${namespace}
        AND key = ${key}
        AND reset_at > to_timestamp(${nowSec})
      LIMIT 1
    `);
    const row = result.rows?.[0];
    if (!row) return null;
    return { count: Number(row.count), resetAt: Number(row.reset_at_ms) };
  }

  async countActive(namespace: string, now: number): Promise<number> {
    const nowSec = now / 1000;
    const result = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM ${signupAssistantCountersTable}
      WHERE namespace = ${namespace}
        AND reset_at > to_timestamp(${nowSec})
    `);
    const row = result.rows?.[0];
    return row ? Number(row.n) : 0;
  }

  async reset(namespace: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM ${signupAssistantCountersTable}
      WHERE namespace = ${namespace}
    `);
  }

  /**
   * Test-only helper to wipe every namespace and reset the sweep
   * cooldown so subsequent increments behave like a fresh process.
   */
  async resetAll(): Promise<void> {
    await db.execute(sql`DELETE FROM ${signupAssistantCountersTable}`);
    this.lastSweepAt = -Infinity;
  }

  // Best-effort prune of rows whose window has elapsed. Runs at
  // most once per `SWEEP_INTERVAL_MS` per process so a high-traffic
  // burst never piles up cleanup work. Failure is logged and
  // swallowed — a missed sweep just leaves harmless dead rows; the
  // next sweep, or the next per-key UPDATE on the same row, will
  // recover.
  private async maybeSweep(now: number): Promise<void> {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    try {
      const nowSec = now / 1000;
      await db.execute(sql`
        DELETE FROM ${signupAssistantCountersTable}
        WHERE reset_at <= to_timestamp(${nowSec})
      `);
    } catch (err) {
      logger.warn(
        { kind: "signup_assistant.pg_store.sweep_failed", err },
        "signup-assistant counter sweep failed; retrying next interval",
      );
    }
  }
}

// Singleton-style holder so the signup-assistant module can resolve
// a single `PostgresBucketStore` for the lifetime of the process
// without each call recreating it (which would also reset the
// per-instance sweep cooldown). Lazily constructed so importing
// this module in tests that never use it doesn't require a DB
// handle to exist yet.
let cachedStore: PostgresBucketStore | null = null;
export function getSignupAssistantPgStore(): PostgresBucketStore {
  if (!cachedStore) cachedStore = new PostgresBucketStore();
  return cachedStore;
}

// Test-only: drop the cached singleton so the next call constructs
// a fresh store with a reset sweep cooldown. Required when a test
// case wants to assert the very-first-call sweep behaviour.
export function __resetSignupAssistantPgStoreForTests(): void {
  cachedStore = null;
}
