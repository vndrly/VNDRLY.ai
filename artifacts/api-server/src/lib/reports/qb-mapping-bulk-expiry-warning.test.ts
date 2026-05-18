// Real-DB test for the qb-account-mapping bulk-action expiry-warning
// worker. Mirrors the opt-in pattern used by `qb-mapping-bulk-cleanup.test.ts`
// and `invoice-aging-worker.test.ts`: hard-skipped unless
// QB_BULK_CLEANUP_REAL_DB_TESTS is explicitly set so a developer pointing
// at a non-test DATABASE_URL can't accidentally exercise the
// destructive INSERT/DELETE paths below.
//
// What this guards (regression coverage that the helper unit tests in
// `qb-mapping-bulk-cleanup-helpers.test.ts` cannot reach):
//   1. The SQL window — the worker must only notify rows whose
//      createdAt sits in the half-open band
//      `[now - retentionDays, now - (retentionDays - expiresSoonDays)]`,
//      and must skip already-undone rows.
//   2. The dedupe key (`bulk_action_expiry:${id}`) — running the worker
//      twice in a row must NOT produce duplicate notifications or
//      duplicate emails for the same action.
//   3. Rows with no `actor_user_id` (e.g. system-recorded actions) must
//      be quietly skipped — there's nobody to warn — without throwing.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

// SendGrid is mocked so the test never reaches outbound email; the
// worker still exercises its "best-effort email" code path so we can
// verify it's invoked once per newly-inserted in-app notification (and
// NOT re-invoked on subsequent dedupe-skipped runs).
vi.mock("../sendgrid", async () => {
  const actual = await vi.importActual<typeof import("../sendgrid")>(
    "../sendgrid",
  );
  return {
    ...actual,
    sendBulkActionExpiringEmail: vi.fn(async () => ({ messageId: "mock" })),
  };
});

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

const MARKER = `bulk-warning-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const day = (n: number) => n * 24 * 60 * 60 * 1000;

describe.runIf(haveRealDb)("qb-mapping-bulk-expiry-warning worker", () => {
  let runBulkActionExpiryWarningScan: typeof import("./qb-mapping-bulk-cleanup").runBulkActionExpiryWarningScan;
  let db: typeof import("@workspace/db").db;
  let qbAccountMappingBulkActionsTable: typeof import("@workspace/db").qbAccountMappingBulkActionsTable;
  let notificationsTable: typeof import("@workspace/db").notificationsTable;
  let usersTable: typeof import("@workspace/db").usersTable;
  let platformSettingsTable: typeof import("@workspace/db").platformSettingsTable;
  let inArray: typeof import("drizzle-orm").inArray;
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let sql: typeof import("drizzle-orm").sql;
  let sendBulkActionExpiringEmailMock: ReturnType<typeof vi.fn>;

  // IDs we own and must clean up at the end.
  const ownedActionIds: number[] = [];
  const ownedUserIds: number[] = [];

  // Test fixture state captured/restored across the suite.
  let actorUserId: number;
  let originalRetentionEnv: string | undefined;
  let originalExpiresSoonEnv: string | undefined;
  let hadPlatformSettingsRow = false;
  let originalPlatformRetention: number | null = null;

  async function insertActionAt(
    summary: string,
    createdAtMs: number,
    overrides: { actorUserId?: number | null; undoneAt?: Date | null } = {},
  ): Promise<number> {
    const actor =
      overrides.actorUserId === undefined ? actorUserId : overrides.actorUserId;
    const [row] = await db
      .insert(qbAccountMappingBulkActionsTable)
      .values({
        kind: "bulk_apply",
        actorUserId: actor,
        actorRole: "admin",
        summary,
        snapshots: [],
      })
      .returning({ id: qbAccountMappingBulkActionsTable.id });
    // Backdate (and optionally mark undone) so we can exercise the
    // warning window deterministically.
    await db
      .update(qbAccountMappingBulkActionsTable)
      .set({
        createdAt: new Date(createdAtMs),
        undoneAt: overrides.undoneAt ?? null,
      })
      .where(eq(qbAccountMappingBulkActionsTable.id, row.id));
    ownedActionIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const dbm = await import("@workspace/db");
    const ormm = await import("drizzle-orm");
    db = dbm.db;
    qbAccountMappingBulkActionsTable = dbm.qbAccountMappingBulkActionsTable;
    notificationsTable = dbm.notificationsTable;
    usersTable = dbm.usersTable;
    platformSettingsTable = dbm.platformSettingsTable;
    inArray = ormm.inArray;
    eq = ormm.eq;
    and = ormm.and;
    sql = ormm.sql;

    // Pin retention/expiresSoon via env so the worker's resolver picks
    // values we can reason about (90/7) regardless of test-DB state.
    originalRetentionEnv = process.env.QB_BULK_ACTION_RETENTION_DAYS;
    originalExpiresSoonEnv = process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS;
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "90";
    process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = "7";

    // The DB-aware retention resolver prefers `platform_settings`
    // when set; null it out so our env-var override actually wins.
    // Restored in afterAll.
    const [existing] = await db
      .select({ days: platformSettingsTable.qbBulkActionRetentionDays })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.id, 1));
    if (existing) {
      hadPlatformSettingsRow = true;
      originalPlatformRetention = existing.days;
      if (existing.days != null) {
        await db
          .update(platformSettingsTable)
          .set({ qbBulkActionRetentionDays: null })
          .where(eq(platformSettingsTable.id, 1));
      }
    }

    // The actor used by every test — gives us a deterministic user_id
    // for the notifications join and a real email so the SendGrid mock
    // gets called.
    const [actor] = await db
      .insert(usersTable)
      .values({
        username: `${MARKER}-actor@example.test`,
        email: `${MARKER}-actor@example.test`,
        passwordHash: "x",
        role: "admin",
        displayName: `${MARKER} Actor`,
      })
      .returning({ id: usersTable.id });
    actorUserId = actor.id;
    ownedUserIds.push(actor.id);

    ({ runBulkActionExpiryWarningScan } = await import(
      "./qb-mapping-bulk-cleanup"
    ));
    const sg = await import("../sendgrid");
    sendBulkActionExpiringEmailMock =
      sg.sendBulkActionExpiringEmail as unknown as ReturnType<typeof vi.fn>;
  });

  afterAll(async () => {
    if (ownedActionIds.length > 0) {
      await db
        .delete(qbAccountMappingBulkActionsTable)
        .where(inArray(qbAccountMappingBulkActionsTable.id, ownedActionIds));
    }
    // Belt-and-suspenders: any rows tagged with our MARKER summary too.
    await db
      .delete(qbAccountMappingBulkActionsTable)
      .where(sql`summary LIKE ${`${MARKER}%`}`);

    if (ownedUserIds.length > 0) {
      // notifications.user_id has ON DELETE CASCADE, so deleting the
      // user removes any notifications we inserted as a side-effect.
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, ownedUserIds));
    }

    if (hadPlatformSettingsRow) {
      await db
        .update(platformSettingsTable)
        .set({ qbBulkActionRetentionDays: originalPlatformRetention })
        .where(eq(platformSettingsTable.id, 1));
    }

    if (originalRetentionEnv === undefined) {
      delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    } else {
      process.env.QB_BULK_ACTION_RETENTION_DAYS = originalRetentionEnv;
    }
    if (originalExpiresSoonEnv === undefined) {
      delete process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS;
    } else {
      process.env.QB_BULK_ACTION_EXPIRES_SOON_DAYS = originalExpiresSoonEnv;
    }
  });

  // (a) The SQL window: only rows with createdAt in (now-90d, now-83d]
  // are picked up. Fresh rows (younger than the band), expired rows
  // (older than the band), and undone rows must all be skipped.
  it("notifies only rows in the [retentionDays - expiresSoonDays, retentionDays) window and skips fresh, expired, and undone rows", async () => {
    const now = new Date();
    sendBulkActionExpiringEmailMock.mockClear();

    const fresh = await insertActionAt(
      `${MARKER}-fresh`,
      now.getTime() - day(5),
    );
    // 89-day-old row sits 1 day from expiry — solidly inside the band.
    const warningEdge = await insertActionAt(
      `${MARKER}-warn-edge`,
      now.getTime() - day(89),
    );
    // 85-day-old row — comfortably inside the warning band.
    const warningMid = await insertActionAt(
      `${MARKER}-warn-mid`,
      now.getTime() - day(85),
    );
    const expired = await insertActionAt(
      `${MARKER}-expired`,
      now.getTime() - day(95),
    );
    const undone = await insertActionAt(
      `${MARKER}-undone`,
      now.getTime() - day(85),
      { undoneAt: new Date(now.getTime() - day(2)) },
    );

    const result = await runBulkActionExpiryWarningScan(now);

    expect(result.retentionDays).toBe(90);
    expect(result.expiresSoonDays).toBe(7);

    const candidateKeys = [fresh, warningEdge, warningMid, expired, undone].map(
      (id) => `bulk_action_expiry:${id}`,
    );
    const notifs = await db
      .select({
        userId: notificationsTable.userId,
        dedupeKey: notificationsTable.dedupeKey,
        type: notificationsTable.type,
      })
      .from(notificationsTable)
      .where(inArray(notificationsTable.dedupeKey, candidateKeys));

    const notifiedKeys = notifs.map((n) => n.dedupeKey).sort();
    expect(notifiedKeys).toEqual(
      [
        `bulk_action_expiry:${warningEdge}`,
        `bulk_action_expiry:${warningMid}`,
      ].sort(),
    );
    for (const n of notifs) {
      expect(n.userId).toBe(actorUserId);
      expect(n.type).toBe("qb_bulk_action_expiring");
    }

    // SendGrid email should have been attempted once per newly-inserted
    // notification (the actor has an email on file).
    const myEmailCalls = sendBulkActionExpiringEmailMock.mock.calls.filter(
      ([args]: [{ summary?: string }]) =>
        typeof args.summary === "string" && args.summary.startsWith(MARKER),
    );
    expect(myEmailCalls).toHaveLength(2);
    expect(result.emailFailures).toBe(0);
  });

  // (b) Dedupe via the `bulk_action_expiry:${id}` key — two scans in a
  // row must yield exactly one notification row (and one email
  // attempt) per action, even though both runs see the row as a
  // candidate.
  it("dedupes per action across consecutive scans via the bulk_action_expiry:{id} key", async () => {
    const now = new Date();
    sendBulkActionExpiringEmailMock.mockClear();

    const action = await insertActionAt(
      `${MARKER}-dedupe`,
      now.getTime() - day(86),
    );

    const first = await runBulkActionExpiryWarningScan(now);
    const second = await runBulkActionExpiryWarningScan(now);

    const dedupeKey = `bulk_action_expiry:${action}`;
    const rows = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, actorUserId),
          eq(notificationsTable.dedupeKey, dedupeKey),
        ),
      );
    expect(rows).toHaveLength(1);

    // Both runs see the row as a candidate (still inside the warning
    // band), but only the first counts it as a newly-inserted
    // notification. The second run's `notified` increment for THIS row
    // must be 0 — checked indirectly via the row count above and the
    // email call count below.
    expect(first.candidates).toBeGreaterThanOrEqual(1);
    expect(second.candidates).toBeGreaterThanOrEqual(1);
    expect(first.notified).toBeGreaterThanOrEqual(1);

    // Emails are only attempted on newly-inserted notifications, so the
    // dedupe key must throttle email exactly the same way it throttles
    // the in-app row. Filter to our specific summary so we don't pick
    // up unrelated rows that the prior tests already notified.
    const dedupeEmailCalls = sendBulkActionExpiringEmailMock.mock.calls.filter(
      ([args]: [{ summary?: string }]) => args.summary === `${MARKER}-dedupe`,
    );
    expect(dedupeEmailCalls).toHaveLength(1);
  });

  // (c) Rows with no actor (system-recorded bulk actions) must be
  // skipped silently — there's nobody to warn — and the worker must
  // not throw or insert orphaned notifications.
  it("skips rows with no actorUserId without throwing or notifying", async () => {
    const now = new Date();
    sendBulkActionExpiringEmailMock.mockClear();

    const orphan = await insertActionAt(
      `${MARKER}-orphan`,
      now.getTime() - day(86),
      { actorUserId: null },
    );

    const result = await runBulkActionExpiryWarningScan(now);

    // The orphan row IS counted as a "candidate" by the SQL filter —
    // the actor-null skip happens in the per-row loop after the query.
    // What matters is that no notification was inserted for it and the
    // worker returned cleanly.
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    expect(result.emailFailures).toBe(0);

    const orphanNotifs = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        eq(notificationsTable.dedupeKey, `bulk_action_expiry:${orphan}`),
      );
    expect(orphanNotifs).toHaveLength(0);

    // And no email was sent for the orphan.
    const orphanEmailCalls = sendBulkActionExpiringEmailMock.mock.calls.filter(
      ([args]: [{ summary?: string }]) => args.summary === `${MARKER}-orphan`,
    );
    expect(orphanEmailCalls).toHaveLength(0);
  });
});

describe.skipIf(haveRealDb)(
  "qb-mapping-bulk-expiry-warning worker (skipped: no real DB)",
  () => {
    it("is skipped when DATABASE_URL is unavailable", () => {
      expect(true).toBe(true);
    });
  },
);
