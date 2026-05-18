import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tests for the Task #858 audit-trail rollups in `ticket-transitions.ts`.
// The helpers run real SQL against `ticket_status_history` (joining
// `user_org_memberships`, `tickets`, `site_locations`, and `vendors`), so
// mocking drizzle would defeat the purpose. Instead, this suite seeds a
// small, marker-isolated dataset into the live test DB and asserts on the
// helper output. When no real DB is reachable (e.g. CI without a working
// DATABASE_URL) the suite is skipped — matching the pattern used by
// `routes/notifications.test.ts`.
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

const MARKER = `ttx-helper-test-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type SeedIds = {
  partnerId: number;
  vendorOneId: number;
  vendorTwoId: number;
  vendorOneUserId: number;
  vendorTwoUserId: number;
  ticketBouncedId: number;
  ticketSingleInviteId: number;
  ticketBouncedAcceptedAt: Date;
  ticketBouncedInvitedAt: Date;
};

let seeded: SeedIds | null = null;
let helpers: typeof import("./ticket-transitions");
let dbModule: typeof import("@workspace/db");

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    usersTable,
    userOrgMembershipsTable,
    siteLocationsTable,
    workTypesTable,
    ticketsTable,
    ticketStatusHistoryTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-P`,
      contactName: "P Contact",
      contactEmail: `${MARKER}-p@example.com`,
    })
    .returning({ id: partnersTable.id });
  const [vendorOne] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-V1`,
      contactName: "V1 Contact",
      contactEmail: `${MARKER}-v1@example.com`,
    })
    .returning({ id: vendorsTable.id });
  const [vendorTwo] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-V2`,
      contactName: "V2 Contact",
      contactEmail: `${MARKER}-v2@example.com`,
    })
    .returning({ id: vendorsTable.id });

  const [vendorOneUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-v1user@example.com`,
      passwordHash: "x",
      role: "member",
      displayName: `${MARKER} v1 user`,
    })
    .returning({ id: usersTable.id });
  const [vendorTwoUser] = await db
    .insert(usersTable)
    .values({
      username: `${MARKER}-v2user@example.com`,
      passwordHash: "x",
      role: "member",
      displayName: `${MARKER} v2 user`,
    })
    .returning({ id: usersTable.id });

  await db.insert(userOrgMembershipsTable).values([
    { userId: vendorOneUser.id, orgType: "vendor", vendorId: vendorOne.id, role: "member" },
    { userId: vendorTwoUser.id, orgType: "vendor", vendorId: vendorTwo.id, role: "member" },
  ]);

  const [site] = await db
    .insert(siteLocationsTable)
    .values({
      partnerId: partner.id,
      name: `${MARKER}-Site`,
      address: "123 Test Way",
      latitude: 0,
      longitude: 0,
      siteCode: `${MARKER}-SC`,
    })
    .returning({ id: siteLocationsTable.id });
  const [workType] = await db
    .insert(workTypesTable)
    .values({ name: `${MARKER}-WT`, category: "test" })
    .returning({ id: workTypesTable.id });

  // Ticket #1 — bounced. Two awaiting_acceptance entries, V1 denied,
  // then V2 accepted. Mean-time and reassignment counts both look at
  // this one.
  const [ticketBounced] = await db
    .insert(ticketsTable)
    .values({
      siteLocationId: site.id,
      vendorId: vendorTwo.id,
      workTypeId: workType.id,
      status: "initiated",
    })
    .returning({ id: ticketsTable.id });
  // Ticket #2 — single invite, accepted on the first try. Should NOT be
  // counted as "bounced" but SHOULD contribute to mean time-to-accept.
  const [ticketSingle] = await db
    .insert(ticketsTable)
    .values({
      siteLocationId: site.id,
      vendorId: vendorOne.id,
      workTypeId: workType.id,
      status: "initiated",
    })
    .returning({ id: ticketsTable.id });

  // History timeline. createdAt is set explicitly so the LAG() window
  // and the mean computation are deterministic.
  // - Bounced ticket: invite V1 @ T0 → deny @ T0+30s → invite V2 @ T0+60s
  //   → accept V2 @ T0+120s. Two invite→accept pairs would overcount; the
  //   helper picks the immediate successor, so only the second pair
  //   (60s gap) is averaged in.
  // - Single ticket: invite V1 @ T0 → accept V1 @ T0+10s.
  const T0 = new Date("2025-01-01T00:00:00Z");
  const at = (offsetSeconds: number) =>
    new Date(T0.getTime() + offsetSeconds * 1000);

  await db.insert(ticketStatusHistoryTable).values([
    // Bounced ticket
    {
      ticketId: ticketBounced.id,
      fromStatus: "initiated",
      toStatus: "awaiting_acceptance",
      actorUserId: null,
      actorRole: "partner",
      reason: "invite vendor 1",
      createdAt: at(0),
    },
    {
      ticketId: ticketBounced.id,
      fromStatus: "awaiting_acceptance",
      toStatus: "denied",
      actorUserId: vendorOneUser.id,
      actorRole: "vendor",
      reason: "No truck available",
      createdAt: at(30),
    },
    {
      ticketId: ticketBounced.id,
      fromStatus: "denied",
      toStatus: "awaiting_acceptance",
      actorUserId: null,
      actorRole: "partner",
      reason: "reassign to vendor 2",
      createdAt: at(60),
    },
    {
      ticketId: ticketBounced.id,
      fromStatus: "awaiting_acceptance",
      toStatus: "initiated",
      actorUserId: vendorTwoUser.id,
      actorRole: "vendor",
      reason: null,
      createdAt: at(120),
    },
    // Single ticket
    {
      ticketId: ticketSingle.id,
      fromStatus: "initiated",
      toStatus: "awaiting_acceptance",
      actorUserId: null,
      actorRole: "partner",
      reason: "invite vendor 1 again",
      createdAt: at(0),
    },
    {
      ticketId: ticketSingle.id,
      fromStatus: "awaiting_acceptance",
      toStatus: "initiated",
      actorUserId: vendorOneUser.id,
      actorRole: "vendor",
      reason: null,
      createdAt: at(10),
    },
    // A second deny by vendor 1 with the same reason but different
    // casing & whitespace, on a non-invite transition, to exercise the
    // case/whitespace-insensitive grouping in `aggregateVendorTransitions`.
    {
      ticketId: ticketSingle.id,
      fromStatus: "in_progress",
      toStatus: "denied",
      actorUserId: vendorOneUser.id,
      actorRole: "vendor",
      reason: "  no truck available  ",
      createdAt: at(200),
    },
  ]);

  return {
    partnerId: partner.id,
    vendorOneId: vendorOne.id,
    vendorTwoId: vendorTwo.id,
    vendorOneUserId: vendorOneUser.id,
    vendorTwoUserId: vendorTwoUser.id,
    ticketBouncedId: ticketBounced.id,
    ticketSingleInviteId: ticketSingle.id,
    ticketBouncedAcceptedAt: at(120),
    ticketBouncedInvitedAt: at(60),
  };
}

async function cleanup() {
  if (!seeded) return;
  const { db } = dbModule;
  // Cascades from tickets -> ticket_status_history (FK has ON DELETE CASCADE).
  // We delete by marker to keep the dev DB clean even if ids overlap on a
  // future re-run.
  await db.execute(sql`delete from tickets where id = ${seeded.ticketBouncedId} or id = ${seeded.ticketSingleInviteId}`);
  await db.execute(sql`delete from work_types where name like ${MARKER + "-%"}`);
  await db.execute(sql`delete from site_locations where site_code like ${MARKER + "-%"}`);
  await db.execute(sql`delete from users where username like ${MARKER + "-%"}`);
  await db.execute(sql`delete from vendors where name like ${MARKER + "-%"}`);
  await db.execute(sql`delete from partners where name like ${MARKER + "-%"}`);
}

describe.runIf(haveRealDb)("ticket-transitions audit-trail rollups (Task #858)", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    helpers = await import("./ticket-transitions");
    seeded = await seed();
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      seeded = null;
    }
  });

  describe("aggregateVendorTransitions", () => {
    it("groups denial reasons case- and whitespace-insensitively", async () => {
      const result = await helpers.aggregateVendorTransitions(seeded!.vendorOneId);
      // Two deny rows for V1 with different casing/whitespace must
      // collapse into one bucket.
      expect(result.topDenialReasons).toEqual([
        { reason: "no truck available", count: 2 },
      ]);
    });

    it("derives accept rate from actor-attributed transitions, not the ticket's current vendor", async () => {
      // V1 user authored: 1 accept (single ticket) + 2 denies => 33%.
      const v1 = await helpers.aggregateVendorTransitions(seeded!.vendorOneId);
      expect(v1.acceptCount).toBe(1);
      expect(v1.denyCount).toBe(2);
      expect(v1.acceptRatePercent).toBe(33);
      // V2 user authored: 1 accept, 0 denies => 100%.
      // The bounced ticket's current `tickets.vendor_id` is V2; this
      // assertion proves we attribute via `user_org_memberships` instead
      // of the (mutable) ticket vendor pointer.
      const v2 = await helpers.aggregateVendorTransitions(seeded!.vendorTwoId);
      expect(v2.acceptCount).toBe(1);
      expect(v2.denyCount).toBe(0);
      expect(v2.acceptRatePercent).toBe(100);
    });
  });

  describe("aggregatePartnerTransitions", () => {
    it("averages every immediate invite→accept pair across the partner's tickets", async () => {
      const result = await helpers.aggregatePartnerTransitions(seeded!.partnerId);
      // Pairs averaged in:
      //   bounced ticket: invite@60s -> accept@120s = 60s
      //   single ticket:  invite@0s  -> accept@10s  = 10s
      // The bounced ticket's first invite (T0) is followed by a `denied`,
      // not an `awaiting_acceptance → initiated` row, so the helper
      // correctly skips it instead of pairing T0 → 120s (which would
      // wildly inflate the mean).
      expect(result.acceptedInviteCount).toBe(2);
      expect(result.meanTimeToAcceptanceSeconds).toBe(35);
    });
  });

  describe("aggregateAdminReassignments", () => {
    it("counts only tickets with 2+ awaiting_acceptance rows and surfaces them in the drilldown", async () => {
      const result = await helpers.aggregateAdminReassignments();
      const bounced = result.tickets.find(
        (t) => t.ticketId === seeded!.ticketBouncedId,
      );
      expect(bounced).toBeDefined();
      expect(bounced!.vendorInviteCount).toBe(2);
      // Current vendor pointer is V2 (the accepter), proving the
      // drilldown joins through `tickets.vendor_id` for the *current*
      // assignment even though the audit history attributes work to V1
      // and V2 separately.
      expect(bounced!.currentVendorId).toBe(seeded!.vendorTwoId);
      // The single-invite ticket must NOT appear in the drilldown.
      const single = result.tickets.find(
        (t) => t.ticketId === seeded!.ticketSingleInviteId,
      );
      expect(single).toBeUndefined();
      // The total count is global, but the bounced ticket must be among
      // the rows it covers.
      expect(result.reassignedTicketCount).toBeGreaterThanOrEqual(1);
    });
  });
});
