// Real-DB test for the qb-account-mapping bulk-action retention worker.
// Skips when DATABASE_URL is unavailable. Mirrors the opt-in pattern used
// by invoice-aging-worker.test.ts: a developer who happens to have a
// non-test DATABASE_URL pointed at staging/prod will not accidentally run
// the destructive INSERT/DELETE paths below — CI sets QB_BULK_CLEANUP_REAL_DB_TESTS=1.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const REAL_DB_OPT_IN =
  process.env.QB_BULK_CLEANUP_REAL_DB_TESTS === "1" ||
  process.env.QB_BULK_CLEANUP_REAL_DB_TESTS === "true";

async function checkDatabase(): Promise<boolean> {
  if (!REAL_DB_OPT_IN) return false;
  if (!DATABASE_URL) return false;
  if (DATABASE_URL.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

const haveRealDb = await checkDatabase();

const MARKER = `bulk-cleanup-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const day = (n: number) => n * 24 * 60 * 60 * 1000;

describe.runIf(haveRealDb)("qb-mapping-bulk-cleanup", () => {
  let runBulkActionCleanup: typeof import("./qb-mapping-bulk-cleanup").runBulkActionCleanup;
  let runBulkActionExpiryWarningScan: typeof import("./qb-mapping-bulk-cleanup").runBulkActionExpiryWarningScan;
  let db: typeof import("@workspace/db").db;
  let qbAccountMappingBulkActionsTable: typeof import("@workspace/db").qbAccountMappingBulkActionsTable;
  let notificationsTable: typeof import("@workspace/db").notificationsTable;
  let notificationPreferencesTable: typeof import("@workspace/db").notificationPreferencesTable;
  let usersTable: typeof import("@workspace/db").usersTable;
  let inArray: typeof import("drizzle-orm").inArray;
  let eq: typeof import("drizzle-orm").eq;
  let sql: typeof import("drizzle-orm").sql;

  // IDs we own and must clean up at the end.
  const ownedIds: number[] = [];

  async function insertActionAt(
    summary: string,
    createdAtMs: number,
    snapshots: import("@workspace/db").QbBulkActionSnapshotEntry[] = [],
  ): Promise<number> {
    const [row] = await db
      .insert(qbAccountMappingBulkActionsTable)
      .values({
        kind: "bulk_apply",
        actorUserId: null,
        actorRole: "admin",
        summary,
        snapshots,
      })
      .returning({ id: qbAccountMappingBulkActionsTable.id });
    // Backdate so we can exercise the retention cutoff deterministically.
    await db
      .update(qbAccountMappingBulkActionsTable)
      .set({ createdAt: new Date(createdAtMs) })
      .where(eq(qbAccountMappingBulkActionsTable.id, row.id));
    ownedIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const dbm = await import("@workspace/db");
    const ormm = await import("drizzle-orm");
    db = dbm.db;
    qbAccountMappingBulkActionsTable = dbm.qbAccountMappingBulkActionsTable;
    notificationsTable = dbm.notificationsTable;
    notificationPreferencesTable = dbm.notificationPreferencesTable;
    usersTable = dbm.usersTable;
    inArray = ormm.inArray;
    eq = ormm.eq;
    sql = ormm.sql;
    ({ runBulkActionCleanup, runBulkActionExpiryWarningScan } = await import(
      "./qb-mapping-bulk-cleanup"
    ));
  });

  afterAll(async () => {
    if (ownedIds.length > 0) {
      await db
        .delete(qbAccountMappingBulkActionsTable)
        .where(inArray(qbAccountMappingBulkActionsTable.id, ownedIds));
    }
    // Belt-and-suspenders: any rows tagged with our MARKER summary too.
    await db
      .delete(qbAccountMappingBulkActionsTable)
      .where(sql`summary LIKE ${`${MARKER}%`}`);
  });

  it("deletes rows older than retentionDays and preserves recent ones", async () => {
    const now = new Date();
    const ancient = await insertActionAt(
      `${MARKER}-ancient`,
      now.getTime() - day(120),
    );
    const old = await insertActionAt(
      `${MARKER}-old`,
      now.getTime() - day(95),
    );
    const recent = await insertActionAt(
      `${MARKER}-recent`,
      now.getTime() - day(10),
    );

    const result = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1 },
      now,
    );

    expect(result.deleted).toBeGreaterThanOrEqual(2);

    const survivors = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(
        inArray(qbAccountMappingBulkActionsTable.id, [ancient, old, recent]),
      );
    const survivingIds = survivors.map((r) => r.id);
    expect(survivingIds).toContain(recent);
    expect(survivingIds).not.toContain(ancient);
    expect(survivingIds).not.toContain(old);
  });

  it("preserves the N most-recent rows even when all are past retention", async () => {
    const now = new Date();
    // All three rows are well past the retention window.
    const a = await insertActionAt(`${MARKER}-q1`, now.getTime() - day(200));
    const b = await insertActionAt(`${MARKER}-q2`, now.getTime() - day(190));
    const c = await insertActionAt(`${MARKER}-q3`, now.getTime() - day(180));

    // minRetained=2 must keep the two most-recent of those (b and c) even
    // though every row is past the retention cutoff.
    await runBulkActionCleanup({ retentionDays: 90, minRetained: 2 }, now);

    const survivors = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(inArray(qbAccountMappingBulkActionsTable.id, [a, b, c]));
    const survivingIds = survivors.map((r) => r.id).sort((x, y) => x - y);
    expect(survivingIds).toEqual([b, c].sort((x, y) => x - y));
  });

  it("is a no-op when nothing is past the retention window", async () => {
    const now = new Date();
    const fresh = await insertActionAt(
      `${MARKER}-fresh`,
      now.getTime() - day(5),
    );

    const result = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1 },
      now,
    );
    // We can't assert deleted===0 globally (other tests' data may exist),
    // but the row we just inserted MUST still be present.
    const [still] = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, fresh));
    expect(still?.id).toBe(fresh);
    expect(result.retentionDays).toBe(90);
    expect(result.minRetained).toBe(1);
    expect(result.dryRun).toBe(false);
  });

  // bytesFreed must reflect the on-disk JSONB snapshot size of the rows the
  // sweep is about to delete (or, in dry-run, would delete). The exact byte
  // count depends on PG's JSONB encoding and TOAST framing, so we only
  // assert it's strictly positive when there's a non-empty snapshot in the
  // candidate set — that's enough to catch a regression where pg_column_size
  // is dropped or summed against the wrong column. The dry-run and apply
  // paths must agree because the apply path computes bytes BEFORE deleting.
  it("reports bytesFreed for the deletion candidate set", async () => {
    const now = new Date();
    const oldId = await insertActionAt(
      `${MARKER}-bytes-old`,
      now.getTime() - day(150),
      [
        {
          vendorId: 1,
          partnerId: 2,
          lineType: "labor",
          previous: { accountName: "Old labor", accountNumber: "5000" },
          applied: { accountName: "New labor", accountNumber: "5100" },
        },
        {
          vendorId: 3,
          partnerId: 4,
          lineType: "materials",
          previous: null,
          applied: { accountName: "New materials", accountNumber: "5200" },
        },
      ],
    );

    const preview = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1, dryRun: true },
      now,
    );
    expect(preview.bytesFreed).toBeGreaterThan(0);

    const apply = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1 },
      now,
    );
    // Apply must free at least as many bytes as the preview promised — the
    // candidate set can only grow between the two calls (other admins may
    // have inserted additional aging rows), never shrink.
    expect(apply.bytesFreed).toBeGreaterThanOrEqual(preview.bytesFreed);
    expect(apply.dryRun).toBe(false);

    const after = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, oldId));
    expect(after).toHaveLength(0);
  });

  // dryRun=true must report the count of rows that *would* be deleted but
  // leave every row in place. The follow-up apply call (dryRun=false) must
  // then delete at least the same set, so the admin "preview → confirm"
  // flow can't surprise an admin by deleting fewer or more rows than the
  // preview promised.
  it("dryRun reports the candidate count without deleting anything", async () => {
    const now = new Date();
    const old1 = await insertActionAt(
      `${MARKER}-dry1`,
      now.getTime() - day(150),
    );
    const old2 = await insertActionAt(
      `${MARKER}-dry2`,
      now.getTime() - day(140),
    );
    const recent = await insertActionAt(
      `${MARKER}-dry-recent`,
      now.getTime() - day(2),
    );

    const preview = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1, dryRun: true },
      now,
    );
    expect(preview.dryRun).toBe(true);
    // Both old rows are past the cutoff; minRetained=1 keeps the recent one
    // (which is also the most-recent overall), so the preview must report
    // at least our two rows as deletion candidates.
    expect(preview.deleted).toBeGreaterThanOrEqual(2);

    // All three rows must still be present after the preview.
    const survivors = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(
        inArray(qbAccountMappingBulkActionsTable.id, [old1, old2, recent]),
      );
    const survivingIds = survivors.map((r) => r.id).sort((a, b) => a - b);
    expect(survivingIds).toEqual([old1, old2, recent].sort((a, b) => a - b));

    // A subsequent real run with the same options must actually delete
    // them, leaving only the recent row.
    const apply = await runBulkActionCleanup(
      { retentionDays: 90, minRetained: 1 },
      now,
    );
    expect(apply.dryRun).toBe(false);
    expect(apply.deleted).toBeGreaterThanOrEqual(2);

    const after = await db
      .select({ id: qbAccountMappingBulkActionsTable.id })
      .from(qbAccountMappingBulkActionsTable)
      .where(
        inArray(qbAccountMappingBulkActionsTable.id, [old1, old2, recent]),
      );
    const afterIds = after.map((r) => r.id);
    expect(afterIds).toContain(recent);
    expect(afterIds).not.toContain(old1);
    expect(afterIds).not.toContain(old2);
  });

  // ── Task #796: per-user channel preferences for the expiry-warning worker
  //
  // Each scenario inserts a fresh actor + bulk-action row, sets the actor's
  // notification_preferences accordingly, runs one warning scan, and asserts
  // both the result counters and the side effects (notifications row + the
  // expiry_warning_processed_at stamp). We use the same MARKER suffix as
  // the cleanup tests so afterAll() reaps every row we leak.

  // Track ids we own across the warning tests so afterAll cleanup catches
  // them (notifications cascade-delete with the user, but the test users
  // and notification_preferences rows we create here need explicit cleanup).
  const ownedUserIds: number[] = [];
  const ownedActionIdsForWarn: number[] = [];

  async function insertActorWithPrefs(
    suffix: string,
    prefs: { inApp: boolean; email: boolean },
  ): Promise<{ userId: number; email: string }> {
    const username = `${MARKER}-${suffix}@example.com`;
    const [u] = await db
      .insert(usersTable)
      .values({
        username,
        email: username,
        passwordHash: "x",
        role: "admin",
        displayName: username,
      })
      .returning({ id: usersTable.id });
    ownedUserIds.push(u.id);
    await db.insert(notificationPreferencesTable).values({
      userId: u.id,
      qbBulkExpiryInAppEnabled: prefs.inApp,
      qbBulkExpiryEmailEnabled: prefs.email,
    });
    return { userId: u.id, email: username };
  }

  async function insertWarnableAction(
    summary: string,
    actorUserId: number | null,
    daysAgo: number,
  ): Promise<number> {
    const [row] = await db
      .insert(qbAccountMappingBulkActionsTable)
      .values({
        kind: "bulk_apply",
        actorUserId,
        actorRole: "admin",
        summary,
        snapshots: [],
      })
      .returning({ id: qbAccountMappingBulkActionsTable.id });
    await db
      .update(qbAccountMappingBulkActionsTable)
      .set({ createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
      .where(eq(qbAccountMappingBulkActionsTable.id, row.id));
    ownedActionIdsForWarn.push(row.id);
    ownedIds.push(row.id);
    return row.id;
  }

  afterAll(async () => {
    if (ownedActionIdsForWarn.length > 0) {
      await db
        .delete(qbAccountMappingBulkActionsTable)
        .where(
          inArray(qbAccountMappingBulkActionsTable.id, ownedActionIdsForWarn),
        );
    }
    if (ownedUserIds.length > 0) {
      // notifications + notification_preferences cascade on user delete.
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, ownedUserIds));
    }
  });

  it("inserts in-app and stamps processed when both channels are enabled (default)", async () => {
    const { userId } = await insertActorWithPrefs("warn-both", {
      inApp: true,
      email: true,
    });
    // Place the row inside the warning band: 85 days old at 90-day
    // retention and 7-day warning band → 5 days remaining.
    const id = await insertWarnableAction(`${MARKER}-warn-both`, userId, 85);

    const r = await runBulkActionExpiryWarningScan();
    expect(r.candidates).toBeGreaterThanOrEqual(1);
    expect(r.notified).toBeGreaterThanOrEqual(1);

    // Notification row inserted with the expected dedupeKey.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `bulk_action_expiry:${id}`));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(userId);
    expect(notifs[0].type).toBe("qb_bulk_action_expiring");

    // Row was stamped — a follow-up scan must NOT re-process it.
    const [stamped] = await db
      .select({ at: qbAccountMappingBulkActionsTable.expiryWarningProcessedAt })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, id));
    expect(stamped.at).not.toBeNull();

    const r2 = await runBulkActionExpiryWarningScan();
    // The stamped row must not appear as a candidate again.
    const notifs2 = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `bulk_action_expiry:${id}`));
    expect(notifs2).toHaveLength(1); // still exactly one
    expect(r2.notified).toBeLessThan(r.notified + 1);
  });

  it("skips in-app when actor opted out of in-app channel", async () => {
    const { userId } = await insertActorWithPrefs("warn-emailonly", {
      inApp: false,
      email: true,
    });
    const id = await insertWarnableAction(
      `${MARKER}-warn-emailonly`,
      userId,
      85,
    );

    await runBulkActionExpiryWarningScan();

    // No in-app notification row should exist for this dedupeKey.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `bulk_action_expiry:${id}`));
    expect(notifs).toHaveLength(0);

    // But the row must still be stamped so we don't keep re-considering it.
    const [stamped] = await db
      .select({ at: qbAccountMappingBulkActionsTable.expiryWarningProcessedAt })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, id));
    expect(stamped.at).not.toBeNull();
  });

  it("sends nothing and counts skippedByPreference when both channels are off", async () => {
    const { userId } = await insertActorWithPrefs("warn-off", {
      inApp: false,
      email: false,
    });
    const id = await insertWarnableAction(`${MARKER}-warn-off`, userId, 85);

    const before = await runBulkActionExpiryWarningScan();
    // Counter must include this row's "off" decision.
    expect(before.skippedByPreference).toBeGreaterThanOrEqual(1);

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `bulk_action_expiry:${id}`));
    expect(notifs).toHaveLength(0);

    const [stamped] = await db
      .select({ at: qbAccountMappingBulkActionsTable.expiryWarningProcessedAt })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, id));
    expect(stamped.at).not.toBeNull();
  });

  it("backfills processed_at for legacy rows that already have a notification", async () => {
    // Simulate a row from before Task #796: warning-band age, with a
    // pre-existing dedupeKey notifications row, but no
    // expiry_warning_processed_at yet.
    const { userId } = await insertActorWithPrefs("warn-legacy", {
      inApp: true,
      email: true,
    });
    const id = await insertWarnableAction(
      `${MARKER}-warn-legacy`,
      userId,
      85,
    );
    // Pre-seed the notification row that the old worker would have left
    // behind, and explicitly clear processed_at to simulate the
    // pre-migration state.
    await db.insert(notificationsTable).values({
      userId,
      type: "qb_bulk_action_expiring",
      category: "system",
      dedupeKey: `bulk_action_expiry:${id}`,
      title: "legacy warning",
      body: null,
      link: "/reports",
    });
    await db
      .update(qbAccountMappingBulkActionsTable)
      .set({ expiryWarningProcessedAt: null })
      .where(eq(qbAccountMappingBulkActionsTable.id, id));

    const r = await runBulkActionExpiryWarningScan();
    expect(r.backfilledFromLegacy).toBeGreaterThanOrEqual(1);

    // Row is now stamped — and there is still exactly one notification
    // (no duplicate from a re-warn).
    const [stamped] = await db
      .select({ at: qbAccountMappingBulkActionsTable.expiryWarningProcessedAt })
      .from(qbAccountMappingBulkActionsTable)
      .where(eq(qbAccountMappingBulkActionsTable.id, id));
    expect(stamped.at).not.toBeNull();

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `bulk_action_expiry:${id}`));
    expect(notifs).toHaveLength(1);
  });
});

// ─── Retention-precedence regression tests ────────────────────────
//
// The retention window has three sources, in precedence order:
//   1. `platform_settings.qbBulkActionRetentionDays` (admin-set)
//   2. `QB_BULK_ACTION_RETENTION_DAYS` env var
//   3. `DEFAULT_RETENTION_DAYS` (90)
//
// The original suite above only exercised path #2/#3 implicitly (it
// always passed an explicit `retentionDays` to `runBulkActionCleanup`).
// These tests pin down what happens when the worker resolves the value
// itself — i.e. the production codepath that runs every 24h. Without
// this coverage, a future regression in `getBulkActionRetentionDays`
// (e.g. silently swallowing the DB read, returning the wrong field, or
// dropping the platform_settings precedence) would let undo snapshots
// pile up indefinitely while the cleanup worker logs success.
describe.runIf(haveRealDb)(
  "qb-mapping-bulk-cleanup retention precedence",
  () => {
    let db: typeof import("@workspace/db").db;
    let platformSettingsTable: typeof import("@workspace/db").platformSettingsTable;
    let qbAccountMappingBulkActionsTable: typeof import("@workspace/db").qbAccountMappingBulkActionsTable;
    let eq: typeof import("drizzle-orm").eq;
    let inArray: typeof import("drizzle-orm").inArray;
    let getBulkActionRetentionDays: typeof import("./qb-mapping-bulk-cleanup").getBulkActionRetentionDays;
    let runBulkActionCleanup: typeof import("./qb-mapping-bulk-cleanup").runBulkActionCleanup;
    let DEFAULT_RETENTION_DAYS: typeof import("./qb-mapping-bulk-cleanup").DEFAULT_RETENTION_DAYS;

    // The platform_settings table is a singleton (id=1) shared with the
    // rest of the app. We snapshot the override field on entry and
    // restore it on exit so this suite never leaves the table dirtier
    // than it found it — even if a test in the middle throws. If no
    // row existed at all on entry the snapshot is `null` and we restore
    // by leaving an override-cleared singleton in place — same state
    // `routes/platformSettings.ts:readSingleton` would have created on
    // first read anyway.
    let originalOverride: number | null = null;
    let originalEnv: string | undefined;
    const ownedRetentionIds: number[] = [];

    async function setOverride(days: number | null): Promise<void> {
      // Ensure the singleton row exists, then PATCH the override field
      // in isolation so we don't disturb any other column. ON CONFLICT
      // DO NOTHING mirrors what `routes/platformSettings.ts` does on
      // first read.
      await db
        .insert(platformSettingsTable)
        .values({ id: 1, name: "VNDRLY", qbBulkActionRetentionDays: days })
        .onConflictDoNothing();
      await db
        .update(platformSettingsTable)
        .set({ qbBulkActionRetentionDays: days })
        .where(eq(platformSettingsTable.id, 1));
    }

    async function insertActionAt(
      summary: string,
      createdAtMs: number,
    ): Promise<number> {
      const [row] = await db
        .insert(qbAccountMappingBulkActionsTable)
        .values({
          kind: "bulk_apply",
          actorUserId: null,
          actorRole: "admin",
          summary,
          snapshots: [],
        })
        .returning({ id: qbAccountMappingBulkActionsTable.id });
      await db
        .update(qbAccountMappingBulkActionsTable)
        .set({ createdAt: new Date(createdAtMs) })
        .where(eq(qbAccountMappingBulkActionsTable.id, row.id));
      ownedRetentionIds.push(row.id);
      return row.id;
    }

    beforeAll(async () => {
      const dbm = await import("@workspace/db");
      const ormm = await import("drizzle-orm");
      db = dbm.db;
      platformSettingsTable = dbm.platformSettingsTable;
      qbAccountMappingBulkActionsTable = dbm.qbAccountMappingBulkActionsTable;
      eq = ormm.eq;
      inArray = ormm.inArray;
      ({
        getBulkActionRetentionDays,
        runBulkActionCleanup,
        DEFAULT_RETENTION_DAYS,
      } = await import("./qb-mapping-bulk-cleanup"));

      // Snapshot the existing override so we can restore it later.
      const [row] = await db
        .select({ days: platformSettingsTable.qbBulkActionRetentionDays })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.id, 1));
      originalOverride = row?.days ?? null;
      originalEnv = process.env.QB_BULK_ACTION_RETENTION_DAYS;
    });

    afterAll(async () => {
      // Restore the platform_settings override to what we observed on
      // entry. See note above on the no-row-on-entry case.
      await setOverride(originalOverride);
      // Restore env exactly.
      if (originalEnv === undefined) {
        delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
      } else {
        process.env.QB_BULK_ACTION_RETENTION_DAYS = originalEnv;
      }
      if (ownedRetentionIds.length > 0) {
        await db
          .delete(qbAccountMappingBulkActionsTable)
          .where(
            inArray(
              qbAccountMappingBulkActionsTable.id,
              ownedRetentionIds,
            ),
          );
      }
    });

    it("uses the platform_settings override when set, ignoring env and the 90-day default", async () => {
      // Arrange: set both an env var AND a DB override. The override
      // must win — that's the whole point of the admin-tunable knob.
      process.env.QB_BULK_ACTION_RETENTION_DAYS = "30";
      await setOverride(7);

      const resolved = await getBulkActionRetentionDays();
      expect(resolved).toBe(7);

      // And the worker, when it resolves the value itself (no opts.retentionDays),
      // must thread that 7-day window through to the result so logs and
      // audit rows reflect the active policy.
      const result = await runBulkActionCleanup();
      expect(result.retentionDays).toBe(7);
    });

    it("the worker actually deletes rows older than the platform_settings override (not the env var)", async () => {
      // Override = 7 days, env var = 90 days. A row created 14 days ago
      // is past the OVERRIDE but well inside the env-var window. If the
      // worker silently fell back to the env var, this row would survive.
      process.env.QB_BULK_ACTION_RETENTION_DAYS = "90";
      await setOverride(7);

      const now = new Date();
      const fourteenDayOld = await insertActionAt(
        `${MARKER}-precedence-14d`,
        now.getTime() - day(14),
      );
      // A second, more-recent row to satisfy the minRetained=1 floor so
      // the 14-day row is genuinely a deletion candidate (otherwise the
      // floor would protect it as the most-recent row).
      await insertActionAt(
        `${MARKER}-precedence-recent`,
        now.getTime() - day(1),
      );

      await runBulkActionCleanup({ minRetained: 1 }, now);

      const survivors = await db
        .select({ id: qbAccountMappingBulkActionsTable.id })
        .from(qbAccountMappingBulkActionsTable)
        .where(
          inArray(qbAccountMappingBulkActionsTable.id, [fourteenDayOld]),
        );
      expect(survivors).toHaveLength(0);
    });

    it("falls back to the env var when the platform_settings override is cleared", async () => {
      process.env.QB_BULK_ACTION_RETENTION_DAYS = "45";
      await setOverride(null);

      expect(await getBulkActionRetentionDays()).toBe(45);

      const result = await runBulkActionCleanup();
      expect(result.retentionDays).toBe(45);
    });

    it("falls back to the 90-day default when both override and env are unset", async () => {
      delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
      await setOverride(null);

      expect(await getBulkActionRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
      expect(DEFAULT_RETENTION_DAYS).toBe(90);

      const result = await runBulkActionCleanup();
      expect(result.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    });
  },
);

describe.skipIf(haveRealDb)(
  "qb-mapping-bulk-cleanup (skipped: no real DB)",
  () => {
    it("is skipped when DATABASE_URL is unavailable", () => {
      expect(true).toBe(true);
    });
  },
);
