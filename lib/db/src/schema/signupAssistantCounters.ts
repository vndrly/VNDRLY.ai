import {
  pgTable,
  text,
  integer,
  timestamp,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Persistent counter store for the unauthenticated signup-assistant
 * abuse controls (`POST /assistant/signup/:persona/chat`):
 *
 *   • per-IP fixed-window limiter (namespace `SIGNUP_ASSISTANT_IP`)
 *   • global per-day circuit breaker (namespace `SIGNUP_ASSISTANT_DAILY`)
 *
 * Originally those counters lived in process memory (and later in the
 * shared `BucketStore` whose default fell back to an in-process map
 * when no Redis was configured). On a deploy or crash that map reset
 * to zero — momentarily widening the window for an attacker — and a
 * second API replica started its own independent counters.
 *
 * This table is a lightweight, always-available shared backend so the
 * counters survive restarts and stay accurate across replicas without
 * depending on Redis being provisioned. Each row is one bucket:
 *
 *   - `namespace` partitions the per-IP and per-day spaces.
 *   - `key` is the bucket key (the IP address or the UTC day-string
 *     respectively).
 *   - `count` is the number of hits in the current window.
 *   - `resetAt` is when the window expires; once `now > resetAt`, the
 *     next increment opens a fresh window with `count = 1` and a new
 *     `resetAt`.
 *
 * Rows for elapsed windows are swept opportunistically by the store
 * implementation so the table doesn't grow unboundedly. The unique
 * index on `(namespace, key)` is what makes the
 * `INSERT ... ON CONFLICT DO UPDATE` upsert atomic across concurrent
 * requests, even when two API replicas hit the same key at the same
 * instant. We use a surrogate `id` PK + unique index (rather than a
 * composite primary key) because the current drizzle-kit version's
 * `pushSchema` introspection trips on composite PKs.
 */
export const signupAssistantCountersTable = pgTable(
  "signup_assistant_counters",
  {
    id: serial("id").primaryKey(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    namespaceKeyUniq: uniqueIndex("signup_assistant_counters_ns_key_uniq").on(
      t.namespace,
      t.key,
    ),
  }),
);

export type SignupAssistantCounter = typeof signupAssistantCountersTable.$inferSelect;
