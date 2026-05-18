// Retention worker for `qb_account_mapping_bulk_actions`.
//
// Each bulk-apply or CSV-import recorded by `recordBulkAction` writes one
// row carrying a JSONB snapshots[] of every (vendorId, partnerId, lineType)
// cell it touched (capped at 5,000 cells per action, see reports.ts). With
// no retention this table grows without bound: a busy admin doing daily
// CSV imports will accumulate hundreds of MB of snapshot blobs per year.
//
// Policy (configurable via env, sensible defaults):
//   - Delete rows whose `created_at` is older than `retentionDays`
//     (default 90 days).
//   - ALWAYS preserve the `minRetained` most-recent rows (default 20)
//     regardless of age. The `/reports/qb-account-mapping/bulk-actions`
//     endpoint defaults to `limit=20` and the UI's "Undo most recent"
//     affordance walks that list. Pruning the tail-end of a quiet table
//     would silently remove the row the UI's undo button points at, so
//     we keep a floor of recent rows even on inactive deployments.
//
// We do NOT distinguish undone vs. non-undone rows for deletion: an undone
// row's snapshot is no longer useful (the undo already ran), and a
// non-undone row past the retention window is intentionally being aged
// out — admins who care about a stale undo affordance can lengthen
// `QB_BULK_ACTION_RETENTION_DAYS`. The min-retained floor still keeps
// the most-recent action available even when every recent row is undone,
// because the floor is by recency, not by undone state.
//
// Cadence: 24h is plenty — the table only grows on admin activity and
// the unique constraint we care about (most-recent undo) is preserved
// independently. Like the invoice-aging worker we run once on startup
// and then on the configured interval, so a deploy doesn't have to wait
// up to a day for the first sweep.

import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  db,
  notificationPreferencesTable,
  platformSettingsTable,
  qbAccountMappingBulkActionsTable,
  qbAccountMappingCleanupAuditTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../logger";
import { notifyUsers } from "../../routes/notifications";
import { sendBulkActionExpiringEmail } from "../sendgrid";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_MIN_RETAINED = 20;
// How many days of headroom before a row's retention window expires we
// consider it "expiring soon" — surfaces the badge in the history dialog
// and (optionally) emails the actor a warning. Kept short relative to the
// 90-day default so the badge isn't ambient noise on every active row.
export const DEFAULT_EXPIRES_SOON_DAYS = 7;

const MIN_INTERVAL_MS = 60_000; // 1 minute (sanity floor)
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week ceiling
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365 * 5; // 5 years
const MIN_MIN_RETAINED = 1;
const MAX_MIN_RETAINED = 1000;
const MIN_EXPIRES_SOON_DAYS = 1;
const MAX_EXPIRES_SOON_DAYS = 365;

function parseEnvInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    logger.warn(
      { name, raw, fallback, min, max },
      "Invalid env value for bulk-action cleanup; using fallback",
    );
    return fallback;
  }
  return n;
}

// Either the singleton `db` or a transaction handle yielded by
// `db.transaction()`. When the admin "Clean up old snapshots" route runs
// the cleanup it passes a transaction handle so the delete and the
// audit-row insert commit (or roll back) together — see the use site in
// `routes/reports.ts`.
export type BulkActionCleanupExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BulkActionCleanupOptions {
  retentionDays?: number;
  minRetained?: number;
  /**
   * When true, count the rows that *would* be deleted under the resolved
   * `retentionDays`/`minRetained` policy without actually deleting them.
   * The returned `deleted` field carries that count so the admin "run now"
   * UI can preview the impact before confirming.
   */
  dryRun?: boolean;
  /**
   * Optional drizzle executor (e.g. a transaction handle). Defaults to the
   * singleton `db`. Pass a tx so the caller can atomically combine the
   * cleanup delete with their own writes (e.g. an audit row).
   */
  executor?: BulkActionCleanupExecutor;
}

/**
 * Validate-and-clamp helper exposed for the
 * PATCH /platform-settings handler. Mirrors the same min/max bounds the
 * env-var parser uses so a hand-typed value in the admin UI can't
 * accidentally pin the cleanup worker to a junk window.
 */
export const BULK_ACTION_RETENTION_BOUNDS = {
  min: MIN_RETENTION_DAYS,
  max: MAX_RETENTION_DAYS,
} as const;

/**
 * Pure env-var fallback: returns the env-configured retention window
 * (or the code default) without consulting the database. Exported so
 * the env-var unit tests can keep verifying the legacy precedence
 * without spinning up a database.
 */
export function getBulkActionRetentionDaysFromEnv(): number {
  return parseEnvInt(
    "QB_BULK_ACTION_RETENTION_DAYS",
    DEFAULT_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
  );
}

/**
 * Resolve the active undo-retention window (in days). Precedence:
 *   1. `platform_settings.qbBulkActionRetentionDays` (admin-set in the UI)
 *   2. `QB_BULK_ACTION_RETENTION_DAYS` env var
 *   3. `DEFAULT_RETENTION_DAYS` (90)
 *
 * Exported so the cleanup worker, the bulk-actions list endpoint, and
 * the admin "configure retention" UI all agree on the active value.
 * The DB read is a single indexed-pk lookup against the
 * `platform_settings` singleton (id=1); on the rare miss (table not
 * yet seeded, transient DB error) we log and gracefully fall through
 * to the env-var default rather than failing the caller.
 */
export async function getBulkActionRetentionDays(): Promise<number> {
  try {
    const [row] = await db
      .select({
        days: platformSettingsTable.qbBulkActionRetentionDays,
      })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.id, 1));
    const v = row?.days;
    if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= MIN_RETENTION_DAYS &&
      v <= MAX_RETENTION_DAYS
    ) {
      return v;
    }
  } catch (err) {
    logger.warn(
      { err },
      "Failed to read qb_bulk_action_retention_days from platform_settings; falling back to env default",
    );
  }
  return getBulkActionRetentionDaysFromEnv();
}

/**
 * Read the configured "expiring soon" warning window (in days). Mirrors
 * `getBulkActionRetentionDaysFromEnv` so the UI's badge threshold and
 * the server's expiry-warning worker share one source of truth via the
 * `QB_BULK_ACTION_EXPIRES_SOON_DAYS` env var. Clamped to be no larger
 * than the active retention window (a threshold that exceeds retention
 * would mark every active row as expiring) — when the env value would
 * exceed retentionDays we silently cap it so admin misconfiguration
 * doesn't produce a useless badge on every row.
 *
 * When `retentionDays` is omitted we fall back to the env-only resolver
 * rather than the async DB-aware `getBulkActionRetentionDays()` so this
 * helper can stay synchronous. Callers that already know the active
 * (DB-aware) retention window — like the route handler and the
 * warning-scan worker — should pass it explicitly so the ceiling
 * tracks any platform_settings override.
 */
export function getBulkActionExpiresSoonDays(retentionDays?: number): number {
  const raw = parseEnvInt(
    "QB_BULK_ACTION_EXPIRES_SOON_DAYS",
    DEFAULT_EXPIRES_SOON_DAYS,
    MIN_EXPIRES_SOON_DAYS,
    MAX_EXPIRES_SOON_DAYS,
  );
  const ceiling = retentionDays ?? getBulkActionRetentionDaysFromEnv();
  return Math.min(raw, ceiling);
}

/**
 * Compute the per-row undo expiry presented in the bulk-actions list.
 * Returned as a small, pure helper so the route's response shape and the
 * UI's rendering logic both stay testable without booting the express app
 * or seeding a database. `expiresAt` is `createdAt + retentionDays`;
 * `isExpired` is true once `now` is at or past that boundary.
 *
 * Note: this uses `>=`, while the cleanup worker deletes rows with
 * `createdAt < now - retentionDays`. The boundary case (a row whose age
 * is exactly retentionDays) is reported as expired here even though the
 * cleanup sweep wouldn't physically delete it yet — intentionally
 * conservative so the UI hides the Undo button slightly before the next
 * pruning sweep rather than risking a click that races the worker.
 *
 * `expiresSoon` is true on rows that are still inside the retention
 * window but within `expiresSoonDays` of falling out of it. When
 * `expiresSoonDays` is omitted it defaults to 0, meaning the flag is
 * never raised — callers that don't care about the warning band can
 * safely ignore the new field. Already-expired rows return
 * `expiresSoon: false` (they're past the warning window, not in it).
 */
export function computeBulkActionRetentionExpiry(
  createdAt: Date,
  retentionDays: number,
  now: Date = new Date(),
  expiresSoonDays: number = 0,
): { expiresAt: Date; isExpired: boolean; expiresSoon: boolean } {
  const expiresAt = new Date(
    createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000,
  );
  const isExpired = now.getTime() >= expiresAt.getTime();
  const warnMs = expiresSoonDays * 24 * 60 * 60 * 1000;
  const expiresSoon =
    !isExpired && warnMs > 0 && expiresAt.getTime() - now.getTime() <= warnMs;
  return { expiresAt, isExpired, expiresSoon };
}

/**
 * Live snapshot of how much space the `qb_account_mapping_bulk_actions`
 * table is currently using. Surfaced on the QuickBooks mapping reports
 * card so admins can decide whether running the on-demand cleanup is
 * worthwhile *before* opening the cleanup preview dialog.
 *
 * Like `BulkActionCleanupResult.bytesFreed`, the byte counts are derived
 * from `pg_column_size(snapshots)` summed across the matching rows. This
 * intentionally measures the on-disk size of the JSONB snapshot column
 * (the only thing on-demand cleanup reclaims) and not the table-row
 * overhead, indexes, or TOAST chunk slack — admins reading the figure
 * compare it against "bytes freed" reported by the cleanup dialog and
 * those two numbers must use the same definition.
 *
 * Counts and bytes are split by the active retention window so the UI
 * can call out the "past retention" subset (the rows the next sweep —
 * automatic or admin-triggered — will reclaim) separately from the
 * baseline footprint that's still inside the undo window.
 */
export interface BulkActionStorageStats {
  /** Total rows in the bulk-action table. */
  totalCount: number;
  /** Total snapshot bytes across every row in the table. */
  totalBytes: number;
  /** Rows still inside the active retention window (createdAt >= cutoff). */
  withinRetentionCount: number;
  /** Snapshot bytes attributable to the within-retention subset. */
  withinRetentionBytes: number;
  /** Rows past the active retention window (createdAt < cutoff). */
  pastRetentionCount: number;
  /** Snapshot bytes attributable to the past-retention subset. */
  pastRetentionBytes: number;
  /** The retention window (in days) used to compute the split. */
  retentionDays: number;
  /** `now - retentionDays`; rows older than this are "past retention". */
  cutoff: Date;
}

export interface BulkActionStorageStatsOptions {
  /**
   * Override the active retention window. Defaults to
   * `getBulkActionRetentionDays()` so the split matches the worker's
   * definition of "past retention" without callers having to thread
   * the value through.
   */
  retentionDays?: number;
  /**
   * Optional drizzle executor (e.g. a transaction handle). Defaults to
   * the singleton `db`.
   */
  executor?: BulkActionCleanupExecutor;
}

/**
 * Aggregate the live storage footprint of the bulk-action table. Reuses
 * the same `pg_column_size(snapshots)` aggregation `runBulkActionCleanup`
 * uses so the displayed "currently using ~X MB" baseline is directly
 * comparable to the "would free ~Y MB" preview, without admins having
 * to second-guess whether the two figures count the same bytes.
 *
 * The split uses a `FILTER (WHERE createdAt < cutoff)` aggregate so
 * everything is computed in a single round-trip; for a table that's
 * already several MB of JSONB this matters.
 */
export async function getBulkActionStorageStats(
  opts: BulkActionStorageStatsOptions = {},
  now: Date = new Date(),
): Promise<BulkActionStorageStats> {
  const retentionDays =
    opts.retentionDays ?? (await getBulkActionRetentionDays());
  const exec: BulkActionCleanupExecutor = opts.executor ?? db;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  // Same int8→string round-trip dance `runBulkActionCleanup` uses so
  // node-postgres doesn't surprise us with a `string` for SUM and a
  // `number` for COUNT.
  const [agg] = await exec
    .select({
      totalCount: sql<string>`(COUNT(*))::bigint::text`,
      totalBytes: sql<string>`COALESCE(SUM(pg_column_size(${qbAccountMappingBulkActionsTable.snapshots})), 0)::bigint::text`,
      pastRetentionCount: sql<string>`(COUNT(*) FILTER (WHERE ${qbAccountMappingBulkActionsTable.createdAt} < ${cutoff}))::bigint::text`,
      pastRetentionBytes: sql<string>`COALESCE(SUM(pg_column_size(${qbAccountMappingBulkActionsTable.snapshots})) FILTER (WHERE ${qbAccountMappingBulkActionsTable.createdAt} < ${cutoff}), 0)::bigint::text`,
    })
    .from(qbAccountMappingBulkActionsTable);

  const totalCount = Number(agg?.totalCount ?? "0");
  const totalBytes = Number(agg?.totalBytes ?? "0");
  const pastRetentionCount = Number(agg?.pastRetentionCount ?? "0");
  const pastRetentionBytes = Number(agg?.pastRetentionBytes ?? "0");

  return {
    totalCount,
    totalBytes,
    withinRetentionCount: Math.max(0, totalCount - pastRetentionCount),
    withinRetentionBytes: Math.max(0, totalBytes - pastRetentionBytes),
    pastRetentionCount,
    pastRetentionBytes,
    retentionDays,
    cutoff,
  };
}

export interface BulkActionCleanupResult {
  /**
   * Number of rows deleted, or — when `dryRun` is true — the number that
   * would have been deleted.
   */
  deleted: number;
  /**
   * Estimated bytes of JSONB snapshot data that were (or, in dry-run, would
   * be) freed by the delete. Computed as the sum of `pg_column_size(snapshots)`
   * over the deletion candidate set, evaluated *before* the actual DELETE
   * runs. This intentionally measures the on-disk size of the JSONB column
   * value and not the table-row overhead, indexes, or TOAST chunk slack —
   * admins are running the cleanup specifically to reclaim snapshot blob
   * space, so the snapshot column is the meaningful number to surface.
   *
   * Reported as a `number` (always an integer); JSONB snapshots are capped
   * at 5,000 cells per row in `recordBulkAction`, so a year of daily CSV
   * imports fits comfortably below `Number.MAX_SAFE_INTEGER`.
   */
  bytesFreed: number;
  protectedRecent: number;
  retentionDays: number;
  minRetained: number;
  cutoff: Date;
  /** Mirrors the input flag so callers can tell preview from real runs. */
  dryRun: boolean;
}

/**
 * Run a single retention sweep against `qb_account_mapping_bulk_actions`.
 * Exported for tests and for the admin "Clean up old snapshots" action.
 *
 * Pass `dryRun: true` to preview the count of rows that would be deleted
 * under the current policy without actually touching the table — used by
 * the Reports admin UI to show "would delete N row(s)" before the admin
 * confirms.
 */
export async function runBulkActionCleanup(
  opts: BulkActionCleanupOptions = {},
  now: Date = new Date(),
): Promise<BulkActionCleanupResult> {
  const retentionDays =
    opts.retentionDays ?? (await getBulkActionRetentionDays());
  const minRetained =
    opts.minRetained ??
    parseEnvInt(
      "QB_BULK_ACTION_MIN_RETAINED",
      DEFAULT_MIN_RETAINED,
      MIN_MIN_RETAINED,
      MAX_MIN_RETAINED,
    );
  const dryRun = opts.dryRun === true;
  const exec: BulkActionCleanupExecutor = opts.executor ?? db;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  // Look up the IDs of the N most-recent rows; we'll exclude them from the
  // delete predicate so the most-recent-undo affordance is preserved even
  // if every row is past the retention window.
  const recent = await exec
    .select({ id: qbAccountMappingBulkActionsTable.id })
    .from(qbAccountMappingBulkActionsTable)
    .orderBy(desc(qbAccountMappingBulkActionsTable.createdAt))
    .limit(minRetained);
  const protectedIds = recent.map((r) => r.id);

  const where =
    protectedIds.length === 0
      ? lt(qbAccountMappingBulkActionsTable.createdAt, cutoff)
      : and(
          lt(qbAccountMappingBulkActionsTable.createdAt, cutoff),
          notInArray(qbAccountMappingBulkActionsTable.id, protectedIds),
        );

  // Aggregate the candidate set in a single round-trip so the count and
  // the snapshot-byte estimate are taken from the same snapshot of the
  // table. We always evaluate this BEFORE the DELETE so the reported
  // `bytesFreed` describes "approximately how much we just freed" rather
  // than the post-delete (zero) value.
  //
  // pg_column_size returns the on-disk size of the JSONB datum (including
  // any compression / TOAST framing); summed and cast to bigint so a busy
  // year of CSV imports can't overflow int4. We pull it back as text and
  // parseInt in JS to avoid the node-postgres int8→string vs int4→number
  // ambiguity.
  const [agg] = await exec
    .select({
      candidateCount: sql<string>`COUNT(*)::bigint::text`,
      bytesFreed: sql<string>`COALESCE(SUM(pg_column_size(${qbAccountMappingBulkActionsTable.snapshots})), 0)::bigint::text`,
    })
    .from(qbAccountMappingBulkActionsTable)
    .where(where);
  const candidateCount = Number(agg?.candidateCount ?? "0");
  const bytesFreed = Number(agg?.bytesFreed ?? "0");

  let affected: number;
  if (dryRun) {
    // The aggregator above already counted the rows the predicate would
    // touch (and computed bytesFreed in the same query) — reuse that
    // count instead of issuing a second select.
    affected = candidateCount;
  } else {
    const deletedRows = await exec
      .delete(qbAccountMappingBulkActionsTable)
      .where(where)
      .returning({ id: qbAccountMappingBulkActionsTable.id });
    affected = deletedRows.length;
  }

  return {
    deleted: affected,
    bytesFreed,
    protectedRecent: protectedIds.length,
    retentionDays,
    minRetained,
    cutoff,
    dryRun,
  };
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startBulkActionCleanupWorker(intervalMs?: number): void {
  if (intervalHandle) return;
  const ms =
    intervalMs ??
    parseEnvInt(
      "QB_BULK_ACTION_CLEANUP_INTERVAL_MS",
      DEFAULT_INTERVAL_MS,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    );
  void runOnce("startup");
  intervalHandle = setInterval(() => {
    void runOnce("interval");
  }, ms);
  logger.info({ intervalMs: ms }, "QB bulk-action cleanup worker started");
}

export function stopBulkActionCleanupWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// Exported for tests so the audit-write side effect can be verified
// without spinning a 24h interval. Production callers go through
// `startBulkActionCleanupWorker`.
export async function _runScheduledBulkActionCleanupOnce(
  trigger: "startup" | "interval",
): Promise<void> {
  return runOnce(trigger);
}

async function runOnce(trigger: "startup" | "interval"): Promise<void> {
  const start = Date.now();
  try {
    // Mirror the admin "Clean up old snapshots" route's transaction
    // pattern: combine the cleanup delete with the audit-row insert so
    // either both commit or both roll back. Background sweeps run on a
    // schedule with no human in the loop, so the audit row is the only
    // way an admin will ever see that the worker ran — the alternative
    // (logger-only) leaves no durable trail. `actorUserId = null` +
    // `actorRole = "system"` distinguishes scheduled sweeps from on-
    // demand admin runs at read time without a separate column.
    const r = await db.transaction(async (tx) => {
      const inner = await runBulkActionCleanup({ executor: tx });
      await tx.insert(qbAccountMappingCleanupAuditTable).values({
        actorUserId: null,
        actorRole: "system",
        deletedCount: inner.deleted,
        protectedRecent: inner.protectedRecent,
        retentionDays: inner.retentionDays,
        minRetained: inner.minRetained,
        cutoff: inner.cutoff,
      });
      return inner;
    });
    logger.info(
      {
        trigger,
        ms: Date.now() - start,
        deleted: r.deleted,
        bytesFreed: r.bytesFreed,
        protectedRecent: r.protectedRecent,
        retentionDays: r.retentionDays,
        minRetained: r.minRetained,
        cutoff: r.cutoff.toISOString(),
      },
      "QB bulk-action cleanup complete",
    );
  } catch (err) {
    logger.error({ err, trigger }, "QB bulk-action cleanup crashed");
  }
}

// ─── Expiry-warning worker ─────────────────────────────────────────
//
// Runs alongside the cleanup worker. For every bulk action whose
// retention window expires within `expiresSoonDays`, fires a one-shot
// in-app notification (and optionally an email) to the actor so they
// have time to re-review or proactively undo before the snapshot is
// pruned. Idempotency is provided by `notifyUsers`'s dedupeKey
// (`bulk_action_expiry:${rowId}`); re-running on the same row is a
// no-op once the notification has been recorded.
//
// We deliberately scope notifications to the row's `actorUserId`
// because (a) they're the person who can most meaningfully decide
// whether to undo their own change, and (b) blasting every admin on
// every approaching-expiry row would be ambient noise. Rows with no
// actor (e.g. system-recorded actions) are skipped — there's nobody
// to warn.

export interface BulkActionExpiryWarningResult {
  /** Rows that fell inside the warning window and weren't already processed. */
  candidates: number;
  /** New in-app notifications inserted (gated on actor preference + dedupe). */
  notified: number;
  /** Emails sent (gated on actor preference + having an email on file). */
  emailed: number;
  /** Failures while attempting to email — does not block in-app notify. */
  emailFailures: number;
  /**
   * Candidate rows where the actor has opted out of *both* channels (Task #796).
   * We still stamp `expiry_warning_processed_at` so the row doesn't re-enter
   * the worker on the next sweep, but we send nothing.
   */
  skippedByPreference: number;
  /**
   * Rows we marked processed without sending anything because they were
   * already warned by a pre-Task-#796 run (detected via a pre-existing
   * `bulk_action_expiry:<id>` row in `notifications`). Kept as a counter so
   * the first post-deploy sweep's logs make the backfill visible instead
   * of mysteriously zero candidates.
   */
  backfilledFromLegacy: number;
  retentionDays: number;
  expiresSoonDays: number;
}

export async function runBulkActionExpiryWarningScan(
  now: Date = new Date(),
): Promise<BulkActionExpiryWarningResult> {
  // `getBulkActionRetentionDays` is the DB-aware resolver (admin can
  // override via platform_settings); await it so the warning band tracks
  // any admin-set value rather than always falling back to the env.
  const retentionDays = await getBulkActionRetentionDays();
  const expiresSoonDays = getBulkActionExpiresSoonDays(retentionDays);
  const result: BulkActionExpiryWarningResult = {
    candidates: 0,
    notified: 0,
    emailed: 0,
    emailFailures: 0,
    skippedByPreference: 0,
    backfilledFromLegacy: 0,
    retentionDays,
    expiresSoonDays,
  };

  // One-time backfill (cheap re-run on every sweep — only updates rows
  // that haven't been stamped yet). Before Task #796 the worker tracked
  // "already warned" purely via the dedupeKey row in `notifications`;
  // adding `expiry_warning_processed_at` would otherwise re-attempt every
  // active row in the warning band on the first post-deploy sweep, and
  // for users who currently have email enabled that could mean a
  // duplicate email blast. Instead we treat the existence of a
  // `bulk_action_expiry:<id>` notification row as proof the row was
  // already considered, and stamp it now without sending anything.
  // After the first sweep this `UPDATE ... WHERE` matches zero rows and
  // is effectively free.
  const backfill = await db.execute(sql`
    UPDATE qb_account_mapping_bulk_actions ba
    SET expiry_warning_processed_at = ${now}
    WHERE ba.expiry_warning_processed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.dedupe_key = 'bulk_action_expiry:' || ba.id::text
      )
  `);
  // node-postgres / drizzle exposes affected row count as `rowCount` on
  // raw execute results. Tolerate the field being missing on driver
  // variants by coercing through `unknown`.
  const backfillCount = Number(
    (backfill as unknown as { rowCount?: number | null }).rowCount ?? 0,
  );
  result.backfilledFromLegacy = backfillCount;

  // A row is "expiring soon" when:
  //   createdAt + retentionDays - expiresSoonDays <= now < createdAt + retentionDays
  // Translate that into bounds on createdAt for the SQL filter:
  //   createdAt > now - retentionDays              (still inside retention)
  //   createdAt <= now - (retentionDays - expiresSoonDays) (inside warning band)
  const dayMs = 24 * 60 * 60 * 1000;
  const lowerCreatedAt = new Date(now.getTime() - retentionDays * dayMs);
  const upperCreatedAt = new Date(
    now.getTime() - (retentionDays - expiresSoonDays) * dayMs,
  );

  const rows = await db
    .select({
      id: qbAccountMappingBulkActionsTable.id,
      summary: qbAccountMappingBulkActionsTable.summary,
      kind: qbAccountMappingBulkActionsTable.kind,
      createdAt: qbAccountMappingBulkActionsTable.createdAt,
      actorUserId: qbAccountMappingBulkActionsTable.actorUserId,
      actorEmail: usersTable.email,
      actorDisplayName: usersTable.displayName,
    })
    .from(qbAccountMappingBulkActionsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, qbAccountMappingBulkActionsTable.actorUserId),
    )
    .where(
      and(
        // Skip undone rows — no point warning about an action that's
        // already been rolled back.
        isNull(qbAccountMappingBulkActionsTable.undoneAt),
        // Skip rows we (or the legacy backfill above) have already
        // processed. This is the per-row dedup that lets us safely
        // honor "email only" or "off" preferences without re-sending
        // on every sweep.
        isNull(qbAccountMappingBulkActionsTable.expiryWarningProcessedAt),
        // Strict `>` so a row sitting exactly on the retention boundary
        // (daysRemaining === 0, i.e. already expired by the cleanup
        // worker's reckoning) doesn't get a last-second 0-day warning.
        gt(qbAccountMappingBulkActionsTable.createdAt, lowerCreatedAt),
        lte(qbAccountMappingBulkActionsTable.createdAt, upperCreatedAt),
      ),
    );

  result.candidates = rows.length;

  if (rows.length === 0) return result;

  // Batch-load the per-actor preferences in one round trip rather than
  // re-querying inside the per-row loop. Users with no row in
  // `notification_preferences` get the defaults (both channels on),
  // matching the pre-Task-#796 behavior.
  const actorIds = Array.from(
    new Set(
      rows
        .map((r) => r.actorUserId)
        .filter((id): id is number => id != null),
    ),
  );
  const prefRows = actorIds.length
    ? await db
        .select({
          userId: notificationPreferencesTable.userId,
          inApp: notificationPreferencesTable.qbBulkExpiryInAppEnabled,
          email: notificationPreferencesTable.qbBulkExpiryEmailEnabled,
        })
        .from(notificationPreferencesTable)
        .where(inArray(notificationPreferencesTable.userId, actorIds))
    : [];
  const prefByUser = new Map<number, { inApp: boolean; email: boolean }>();
  for (const p of prefRows) {
    prefByUser.set(p.userId, { inApp: p.inApp, email: p.email });
  }

  for (const row of rows) {
    if (row.actorUserId == null) continue; // nobody to warn
    const prefs = prefByUser.get(row.actorUserId) ?? {
      inApp: true,
      email: true,
    };
    const wantInApp = prefs.inApp;
    const wantEmail = prefs.email;

    const { expiresAt } = computeBulkActionRetentionExpiry(
      row.createdAt,
      retentionDays,
      now,
    );
    const daysRemaining = Math.max(
      0,
      Math.ceil((expiresAt.getTime() - now.getTime()) / dayMs),
    );
    const dedupeKey = `bulk_action_expiry:${row.id}`;
    const title = `Undo for "${row.summary}" expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
    const body =
      `This bulk QuickBooks mapping change will fall out of the ` +
      `${retentionDays}-day undo window on ${expiresAt.toLocaleDateString()}. ` +
      `Re-review it now if you want to undo before the snapshot is pruned.`;

    if (wantInApp) {
      const inserted = await notifyUsers([row.actorUserId], {
        type: "qb_bulk_action_expiring",
        title,
        body,
        link: `/reports`,
        category: "system",
        dedupeKey,
      });
      result.notified += inserted;
    }

    // Email is independent of in-app: gated on the actor's email
    // preference (Task #796) and on the actor having an email on file.
    // Failures are logged but never throw — an email outage shouldn't
    // lose the in-app warning, and shouldn't prevent us from stamping
    // `expiry_warning_processed_at` (otherwise a transient SendGrid
    // outage would replay the in-app insert + email forever).
    if (wantEmail && row.actorEmail) {
      try {
        await sendBulkActionExpiringEmail({
          to: row.actorEmail,
          actorName: row.actorDisplayName ?? row.actorEmail,
          summary: row.summary,
          kind: row.kind === "csv_import" ? "csv_import" : "bulk_apply",
          daysRemaining,
          expiresAt,
          retentionDays,
        });
        result.emailed += 1;
      } catch (err) {
        result.emailFailures += 1;
        logger.warn(
          { err, bulkActionId: row.id, actorUserId: row.actorUserId },
          "Bulk-action expiry email failed",
        );
      }
    }

    if (!wantInApp && !wantEmail) {
      result.skippedByPreference += 1;
    }

    // Stamp the row so future sweeps skip it. We do this regardless of
    // whether either channel actually fired — a user with both
    // preferences off has explicitly told us they don't want a warning,
    // and we shouldn't keep re-considering the row for the rest of the
    // 7-day warning band.
    await db
      .update(qbAccountMappingBulkActionsTable)
      .set({ expiryWarningProcessedAt: now })
      .where(eq(qbAccountMappingBulkActionsTable.id, row.id));
  }

  return result;
}

let warningHandle: NodeJS.Timeout | null = null;

export function startBulkActionExpiryWarningWorker(intervalMs?: number): void {
  if (warningHandle) return;
  const ms =
    intervalMs ??
    parseEnvInt(
      "QB_BULK_ACTION_EXPIRY_WARNING_INTERVAL_MS",
      DEFAULT_INTERVAL_MS,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    );
  void runWarningOnce("startup");
  warningHandle = setInterval(() => {
    void runWarningOnce("interval");
  }, ms);
  logger.info(
    { intervalMs: ms },
    "QB bulk-action expiry-warning worker started",
  );
}

export function stopBulkActionExpiryWarningWorker(): void {
  if (warningHandle) {
    clearInterval(warningHandle);
    warningHandle = null;
  }
}

async function runWarningOnce(
  trigger: "startup" | "interval",
): Promise<void> {
  const start = Date.now();
  try {
    const r = await runBulkActionExpiryWarningScan();
    logger.info(
      {
        trigger,
        ms: Date.now() - start,
        ...r,
      },
      "QB bulk-action expiry-warning scan complete",
    );
  } catch (err) {
    logger.error(
      { err, trigger },
      "QB bulk-action expiry-warning scan crashed",
    );
  }
}
