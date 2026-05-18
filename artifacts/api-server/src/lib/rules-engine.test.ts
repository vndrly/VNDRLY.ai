import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// End-to-end coverage for rules-engine recipient resolution against a real
// Postgres. Companion to `routes/notifications.test.ts`, which covers the
// helpers (`findPartnerUserIds`/`findVendorUserIds` and their batched
// variants) directly. This file goes one level higher and asserts the
// integration: a stale ticket → `runRulesEngine()` →
// `notifyUsers([...recipients])` → notifications inserted for users that
// only have a `user_org_memberships` row.
//
// Why the integration test matters: the `rulePendingTicketsLong` rule (and
// every other rule that fans out by partner/vendor org) builds its
// recipient set off `OrgUserCache`, which preloads via
// `findPartnerUserIdsBatch` / `findVendorUserIdsBatch`. Task #195 found
// the visitor-notifier silently dropping users when its SQL referenced a
// non-existent column; the rules engine has the same shape of risk
// because it relies on the membership table being the sole source of
// truth for "who owns this org". A unit test against a mocked DB cannot
// catch a column rename or a mistyped join — only real SQL can.
//
// Pattern mirrors `routes/notifications.test.ts`:
//   • Skipped when DATABASE_URL is unset or points at the offline
//     placeholder used by the unit-test setup.
//   • All seeded rows carry a unique MARKER so cleanup can target only
//     what the suite created without touching anything else, even on the
//     shared `_test` DB used by parallel test files.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkDatabase();

async function checkDatabase(): Promise<boolean> {
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

const MARKER = `rules-engine-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const emailFor = (tag: string) => `${MARKER}-${tag}@example.com`;

type SeedIds = {
  partnerId: number;
  vendorId: number;
  workTypeId: number;
  siteLocationId: number;
  ticketId: number;
  partnerUserId: number;
  vendorUserId: number;
};

let seeded: SeedIds | null = null;
let dbModule: typeof import("@workspace/db");
let rulesEngine: typeof import("./rules-engine");

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    usersTable,
    userOrgMembershipsTable,
    workTypesTable,
    siteLocationsTable,
    ticketsTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-partner`,
      contactName: "P",
      contactEmail: `${MARKER}-p@example.com`,
    })
    .returning({ id: partnersTable.id });
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-vendor`,
      contactName: "V",
      contactEmail: `${MARKER}-v@example.com`,
    })
    .returning({ id: vendorsTable.id });
  // work_types has a case-insensitive uniqueness index on the trimmed
  // name; embed the marker so concurrent test files don't collide.
  const [workType] = await db
    .insert(workTypesTable)
    .values({
      name: `${MARKER}-wt`,
      category: "Other",
    })
    .returning({ id: workTypesTable.id });
  const [siteLocation] = await db
    .insert(siteLocationsTable)
    .values({
      partnerId: partner.id,
      name: `${MARKER}-site`,
      address: "1 Test Way",
      latitude: 0,
      longitude: 0,
      // siteCode is unique across all rows; embed the marker.
      siteCode: `${MARKER}-code`,
    })
    .returning({ id: siteLocationsTable.id });

  // The ticket is stale by 35 days so `rulePendingTicketsLong` (cutoff:
  // 30 days) picks it up. We override updatedAt explicitly because the
  // drizzle column normally `defaultNow()`s on insert and `$onUpdate`s on
  // update — neither path lets us backdate.
  const stale = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      siteLocationId: siteLocation.id,
      vendorId: vendor.id,
      workTypeId: workType.id,
      status: "pending_review",
      createdAt: stale,
      updatedAt: stale,
    })
    .returning({ id: ticketsTable.id });

  // Brand-new users: only a `user_org_memberships` row, no legacy
  // `users.partner_id` / `users.vendor_id` (those columns no longer
  // exist post task #192, but the point stands — the only way to find
  // them is the membership table).
  async function makeUser(tag: string): Promise<number> {
    const [row] = await db
      .insert(usersTable)
      .values({
        username: emailFor(tag),
        passwordHash: "x",
        role: "member",
        displayName: `${MARKER} ${tag}`,
      })
      .returning({ id: usersTable.id });
    return row.id;
  }

  const partnerUserId = await makeUser("partner-only");
  const vendorUserId = await makeUser("vendor-only");

  await db.insert(userOrgMembershipsTable).values([
    {
      userId: partnerUserId,
      orgType: "partner",
      partnerId: partner.id,
      role: "member",
    },
    {
      userId: vendorUserId,
      orgType: "vendor",
      vendorId: vendor.id,
      role: "member",
    },
  ]);

  return {
    partnerId: partner.id,
    vendorId: vendor.id,
    workTypeId: workType.id,
    siteLocationId: siteLocation.id,
    ticketId: ticket.id,
    partnerUserId,
    vendorUserId,
  };
}

async function cleanup() {
  if (!seeded) return;
  const { db } = dbModule;
  // Order matters: notifications and tickets first (FKs to users / vendors
  // / site_locations have no cascade), then site_locations (FK to
  // partners), then the org rows, then the work type. Users are deleted
  // by marker; their memberships cascade.
  await db.execute(
    sql`delete from notifications where user_id in (${seeded.partnerUserId}, ${seeded.vendorUserId})`,
  );
  await db.execute(sql`delete from tickets where id = ${seeded.ticketId}`);
  await db.execute(
    sql`delete from site_locations where id = ${seeded.siteLocationId}`,
  );
  await db.execute(sql`delete from users where username like ${MARKER + "-%"}`);
  await db.execute(sql`delete from partners where name like ${MARKER + "-%"}`);
  await db.execute(sql`delete from vendors where name like ${MARKER + "-%"}`);
  await db.execute(sql`delete from work_types where name like ${MARKER + "-%"}`);
}

describe.runIf(haveRealDb)("rules-engine recipient resolution (membership-backed)", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    rulesEngine = await import("./rules-engine");
    seeded = await seed();
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      seeded = null;
    }
  });

  it("notifies brand-new partner + vendor users about a stale pending ticket", async () => {
    // Run the whole engine — `rulePendingTicketsLong` is what we care
    // about, but we want to assert the production entry point works
    // end-to-end, not a private helper. Other rules running in the same
    // tick will see no matching rows on the isolated test DB and produce
    // no notifications for our seeded users.
    const summary = await rulesEngine.runRulesEngine();
    const pending = summary.find((s) => s.rule === "pending_tickets_long");
    expect(pending).toBeDefined();
    expect(pending!.error).toBeUndefined();

    // Pull just the notifications this run produced for our seeded users
    // and our seeded ticket. Filtering on dedupeKey by the ticket id
    // keeps the assertion stable even if a parallel test happens to
    // seed its own pending ticket against the shared `_test` DB.
    const { db, notificationsTable } = dbModule;
    const rows = await db
      .select({
        userId: notificationsTable.userId,
        type: notificationsTable.type,
        dedupeKey: notificationsTable.dedupeKey,
      })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.dedupeKey, `ticket_pending_long:${seeded!.ticketId}`),
          inArray(notificationsTable.userId, [
            seeded!.partnerUserId,
            seeded!.vendorUserId,
          ]),
        ),
      );

    const recipients = new Set(rows.map((r) => r.userId));
    expect(recipients).toContain(seeded!.partnerUserId);
    expect(recipients).toContain(seeded!.vendorUserId);
    // One row per user (dedupe index `notifications_user_dedupe_unique`
    // enforces this, but assert it explicitly so a regression that
    // generates duplicate recipient lists is also caught).
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.type).toBe("ticket_pending_long");
    }
  }, 30_000);
});

describe.skipIf(haveRealDb)("rules-engine recipient resolution (membership-backed)", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder
    // used by the unit-test setup; this suite seeds real rows and runs
    // the actual SQL the recipient-resolution path issues.
  });
});
