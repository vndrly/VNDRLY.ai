import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedSchema,
  dropStaleIsolatedSchemas,
  hasReachableDatabase,
  type IsolatedSchemaHandle,
} from "../test/db-harness";

// ---------------------------------------------------------------------------
// Tests for the membership-backed recipient lookup helpers in
// routes/notifications.ts. After task #192 these helpers read from
// `user_org_memberships` instead of the dropped `users.partner_id` /
// `users.vendor_id` columns, so they are now the only path that turns a
// partner/vendor org id into the set of user ids notifications should fan
// out to. A regression here would silently stop alerting partner/vendor
// users (rules-engine, inactivity-notifier, comments, tickets, hotlist, and
// visitor check-in flows all depend on these).
//
// The helpers issue real SQL (`db.execute(sql\`...\`)`) for the visitor
// notifier variants, so mocking drizzle would obscure rather than test the
// actual query shape. Instead, this test seeds rows into a per-file
// isolated Postgres schema (see `src/test/db-harness.ts`) so it never
// touches the shared dev DB and never has to clean up by hand — the
// schema is dropped CASCADE in afterAll. When no real DB is reachable
// (e.g. CI without DATABASE_URL set) the suite is skipped.
//
// Note: the `users` table stores the login identifier (an email-style
// string) in `username` — there is no separate `email` column. The
// partner-visitor-notifier helper joins `lower(pc.email) =
// lower(u.username)`, so seeded users use email-style usernames that
// match the partner_contacts row they should be paired with. (Task #195
// fixed this query — it previously joined on `u.email`, which doesn't
// exist, and silently returned zero rows.)
// ---------------------------------------------------------------------------

const HAVE_DB = await hasReachableDatabase();

const emailFor = (tag: string) => `${tag}@example.com`;

type SeedIds = {
  partnerOneId: number;
  partnerTwoId: number;
  vendorOneId: number;
  vendorTwoId: number;
  vendorThreeId: number;
  userAId: number; // partner P1, tagged as visitor notifier on P1
  userBId: number; // partner P1, contact row exists but not visitor-tagged
  userCId: number; // partner P2, no role-tagged contact
  userDId: number; // vendor V1, vendor_people linked via user_id, visitor-tagged
  userEId: number; // vendor V1, no vendor_people row
  userFId: number; // vendor V2, vendor_people linked via membership.vendor_people_id
  userGId: number; // vendor V3, no role-tagged vendor_people (fallback target)
  userDualId: number; // partner P1 AND vendor V1
  vendorPeopleFId: number;
};

let handle: IsolatedSchemaHandle | null = null;
let seeded: SeedIds | null = null;
let notifications: typeof import("./notifications");
let dbModule: typeof import("@workspace/db");
// Captured before any mutation so afterAll can put the env back. Vitest
// already isolates each test file in its own worker process, but keeping
// the host env stable means re-using this file pattern in a non-isolated
// pool (or wiring extra suites into the same worker) won't surprise the
// next consumer.
const originalDatabaseUrl = process.env.DATABASE_URL;

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    usersTable,
    userOrgMembershipsTable,
    partnerContactsTable,
    vendorPeopleTable,
  } = dbModule;

  const [partnerOne] = await db
    .insert(partnersTable)
    .values({
      name: "P1",
      contactName: "P1 Contact",
      contactEmail: "p1@example.com",
    })
    .returning({ id: partnersTable.id });
  const [partnerTwo] = await db
    .insert(partnersTable)
    .values({
      name: "P2",
      contactName: "P2 Contact",
      contactEmail: "p2@example.com",
    })
    .returning({ id: partnersTable.id });
  const [vendorOne] = await db
    .insert(vendorsTable)
    .values({
      name: "V1",
      contactName: "V1 Contact",
      contactEmail: "v1@example.com",
    })
    .returning({ id: vendorsTable.id });
  const [vendorTwo] = await db
    .insert(vendorsTable)
    .values({
      name: "V2",
      contactName: "V2 Contact",
      contactEmail: "v2@example.com",
    })
    .returning({ id: vendorsTable.id });
  const [vendorThree] = await db
    .insert(vendorsTable)
    .values({
      name: "V3",
      contactName: "V3 Contact",
      contactEmail: "v3@example.com",
    })
    .returning({ id: vendorsTable.id });

  // Seeded users use email-style usernames so the partner-visitor-notifier
  // SQL join (`lower(pc.email) = lower(u.username)`) actually matches.
  async function makeUser(tag: string): Promise<number> {
    const [row] = await db
      .insert(usersTable)
      .values({
        username: emailFor(tag),
        passwordHash: "x",
        role: "member",
        displayName: tag,
      })
      .returning({ id: usersTable.id });
    return row.id;
  }

  const userAId = await makeUser("a");
  const userBId = await makeUser("b");
  const userCId = await makeUser("c");
  const userDId = await makeUser("d");
  const userEId = await makeUser("e");
  const userFId = await makeUser("f");
  const userDualId = await makeUser("dual");

  // Memberships -----------------------------------------------------------
  // Intentionally leave users.partner_id / users.vendor_id NULL so the
  // membership-backed resolution is the only path that can find these
  // users. This is the brand-new-user case task #195 calls out: a user
  // created with only a user_org_memberships row must still be reachable
  // by the notifier helpers.
  await db.insert(userOrgMembershipsTable).values([
    { userId: userAId, orgType: "partner", partnerId: partnerOne.id, role: "member" },
    { userId: userBId, orgType: "partner", partnerId: partnerOne.id, role: "member" },
    { userId: userCId, orgType: "partner", partnerId: partnerTwo.id, role: "admin" },
    { userId: userDId, orgType: "vendor", vendorId: vendorOne.id, role: "member" },
    { userId: userEId, orgType: "vendor", vendorId: vendorOne.id, role: "member" },
    // Dual: same user belongs to both a partner and a vendor org.
    { userId: userDualId, orgType: "partner", partnerId: partnerOne.id, role: "member" },
    { userId: userDualId, orgType: "vendor", vendorId: vendorOne.id, role: "member" },
  ]);

  // P1: tag userA's contact with the visitor role; userB's contact has
  // the wrong role; userDual is intentionally not in any contact row so
  // the join filters them out of the visitor-notifier result.
  await db.insert(partnerContactsTable).values([
    {
      partnerId: partnerOne.id,
      jobTitle: "Site Lead",
      name: "A",
      email: emailFor("a"),
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
    },
    {
      partnerId: partnerOne.id,
      jobTitle: "Office",
      name: "B",
      email: emailFor("b"),
      roles: ["Some Other Role"],
    },
  ]);
  // P2: no role-tagged contact at all -> notifier helper falls back to all
  // partner users (i.e. userC).

  // Vendor people --------------------------------------------------------
  // V1: vendor_people row linked via user_id to userD, role-tagged so
  // the vendor-visitor-notifier helper returns userD only (userE has no
  // vendor_people row, userDual has no vendor_people row).
  await db.insert(vendorPeopleTable).values({
    vendorId: vendorOne.id,
    firstName: "User",
    lastName: "D",
    email: emailFor("d"),
    roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
    userId: userDId,
  });

  // V2: vendor_people row NOT linked via user_id; instead the membership
  // row carries vendor_people_id. Exercises the second branch of the
  // helper's join (vp.id = m.vendor_people_id).
  const [vpF] = await db
    .insert(vendorPeopleTable)
    .values({
      vendorId: vendorTwo.id,
      firstName: "User",
      lastName: "F",
      email: emailFor("f"),
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
    })
    .returning({ id: vendorPeopleTable.id });
  await db.insert(userOrgMembershipsTable).values({
    userId: userFId,
    orgType: "vendor",
    vendorId: vendorTwo.id,
    role: "field_employee",
    vendorPeopleId: vpF.id,
  });

  // V3: a vendor with users but no role-tagged vendor_people. Used to
  // verify the visitor-notifier helper falls back to all vendor users.
  const userGId = await makeUser("g");
  await db.insert(userOrgMembershipsTable).values({
    userId: userGId,
    orgType: "vendor",
    vendorId: vendorThree.id,
    role: "member",
  });

  return {
    partnerOneId: partnerOne.id,
    partnerTwoId: partnerTwo.id,
    vendorOneId: vendorOne.id,
    vendorTwoId: vendorTwo.id,
    vendorThreeId: vendorThree.id,
    userAId,
    userBId,
    userCId,
    userDId,
    userEId,
    userFId,
    userGId,
    userDualId,
    vendorPeopleFId: vpF.id,
  };
}

describe.runIf(HAVE_DB)("notification recipient helpers (membership-backed)", () => {
  beforeAll(async () => {
    // Sweep abandoned schemas from prior crashed runs before we add a
    // new one. Cheap when there's nothing to drop and prevents the test
    // DB from accumulating dead schemas over time.
    await dropStaleIsolatedSchemas();
    handle = await createIsolatedSchema("notifications");
    // Pin DATABASE_URL to the isolated schema BEFORE importing
    // @workspace/db: the lib reads the URL once at module load and
    // builds a Pool from it. Vitest's default `pool: 'forks'` runs each
    // test file in its own worker process, so this env mutation is
    // file-local and does not leak into other tests.
    process.env.DATABASE_URL = handle.url;
    dbModule = await import("@workspace/db");
    notifications = await import("./notifications");
    seeded = await seed();
  }, 60_000);

  afterAll(async () => {
    try {
      // Release the Pool's connections so the schema-drop in teardown
      // doesn't have to wait on lingering sessions.
      await dbModule?.pool.end().catch(() => undefined);
    } finally {
      try {
        await handle?.teardown();
      } finally {
        // Restore the env so any later code in this worker (or a future
        // refactor that relaxes vitest's per-file isolation) doesn't
        // pick up the now-deleted isolated-schema URL.
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
        seeded = null;
        handle = null;
      }
    }
  });

  describe("findPartnerUserIds", () => {
    it("returns every user with a partner membership for that org", async () => {
      const ids = await notifications.findPartnerUserIds(seeded!.partnerOneId);
      // userA, userB, and the dual-membership user all belong to P1.
      expect(new Set(ids)).toEqual(
        new Set([seeded!.userAId, seeded!.userBId, seeded!.userDualId]),
      );
    });

    it("scopes results to the requested partner", async () => {
      const ids = await notifications.findPartnerUserIds(seeded!.partnerTwoId);
      expect(ids).toEqual([seeded!.userCId]);
    });

    it("returns each user only once even when they have multiple memberships", async () => {
      // The dual user has both a partner P1 and a vendor V1 membership.
      // findPartnerUserIds should still report them exactly once for P1.
      const ids = await notifications.findPartnerUserIds(seeded!.partnerOneId);
      const dualOccurrences = ids.filter((id) => id === seeded!.userDualId).length;
      expect(dualOccurrences).toBe(1);
    });

    it("returns an empty list for an org with no memberships", async () => {
      const ids = await notifications.findPartnerUserIds(-1);
      expect(ids).toEqual([]);
    });
  });

  describe("findVendorUserIds", () => {
    it("returns every user with a vendor membership for that org", async () => {
      const ids = await notifications.findVendorUserIds(seeded!.vendorOneId);
      // userD, userE, and the dual user all belong to V1.
      expect(new Set(ids)).toEqual(
        new Set([seeded!.userDId, seeded!.userEId, seeded!.userDualId]),
      );
    });

    it("returns the dual-membership user when looking up by vendor too", async () => {
      // Same user shows up in both findPartnerUserIds(P1) and
      // findVendorUserIds(V1). This is the regression the task calls out:
      // partner/vendor lookups must not exclude users via single-row
      // legacy column reads.
      const partnerIds = await notifications.findPartnerUserIds(seeded!.partnerOneId);
      const vendorIds = await notifications.findVendorUserIds(seeded!.vendorOneId);
      expect(partnerIds).toContain(seeded!.userDualId);
      expect(vendorIds).toContain(seeded!.userDualId);
    });

    it("returns each user only once even when they have multiple memberships", async () => {
      // The dual user has both a partner P1 and a vendor V1 membership;
      // findVendorUserIds should still report them exactly once for V1.
      // (Symmetric with the partner-side dedupe assertion above.)
      const ids = await notifications.findVendorUserIds(seeded!.vendorOneId);
      const dualOccurrences = ids.filter((id) => id === seeded!.userDualId).length;
      expect(dualOccurrences).toBe(1);
    });

    it("returns an empty list for an org with no memberships", async () => {
      const ids = await notifications.findVendorUserIds(-1);
      expect(ids).toEqual([]);
    });
  });

  describe("findPartnerVisitNotifierUserIds", () => {
    it("returns only users whose partner contact has the visitor role", async () => {
      const ids = await notifications.findPartnerVisitNotifierUserIds(
        seeded!.partnerOneId,
      );
      // userA's contact carries VISIT_NOTIFICATIONS_ROLE. userB's contact
      // exists but with a different role. userDual has no contact row.
      expect(ids).toEqual([seeded!.userAId]);
    });

    it("excludes users whose only matching contact carries a non-visitor role", async () => {
      // Explicitly assert the negative case Task #195 calls out: an
      // untagged user with a partner_contacts row of the wrong role
      // must NOT be included in the visitor-notifier result.
      const ids = await notifications.findPartnerVisitNotifierUserIds(
        seeded!.partnerOneId,
      );
      expect(ids).not.toContain(seeded!.userBId);
    });

    it("falls back to all partner users when no contact is role-tagged", async () => {
      const ids = await notifications.findPartnerVisitNotifierUserIds(
        seeded!.partnerTwoId,
      );
      expect(ids).toEqual([seeded!.userCId]);
    });
  });

  describe("findPartnerUserIdsBatch", () => {
    // The rules engine never calls findPartnerUserIds one org at a time; it
    // batches via findPartnerUserIdsBatch through OrgUserCache. A regression
    // here would silently drop brand-new (membership-only) partner users
    // from every fan-out the rules engine drives — pending tickets, ticket
    // status changes, ticket notes, long check-ins. Cover the same brand-
    // new-user path the singleton has, plus the multi-org batching shape.
    it("returns memberships for every requested partner in a single call", async () => {
      const map = await notifications.findPartnerUserIdsBatch([
        seeded!.partnerOneId,
        seeded!.partnerTwoId,
      ]);
      expect(new Set(map.get(seeded!.partnerOneId))).toEqual(
        new Set([seeded!.userAId, seeded!.userBId, seeded!.userDualId]),
      );
      expect(map.get(seeded!.partnerTwoId)).toEqual([seeded!.userCId]);
    });

    it("includes membership-only users (users.partner_id NULL) in the result", async () => {
      // Belt-and-suspenders for the regression that prompted task #198: a
      // brand-new user with only a user_org_memberships row and no legacy
      // users.partner_id must still surface here, because the rules
      // engine's OrgUserCache preload feeds straight into recipient sets.
      const map = await notifications.findPartnerUserIdsBatch([
        seeded!.partnerOneId,
      ]);
      expect(map.get(seeded!.partnerOneId)).toContain(seeded!.userAId);
      expect(map.get(seeded!.partnerOneId)).toContain(seeded!.userDualId);
    });

    it("returns an empty array (not undefined) for orgs with no members", async () => {
      // OrgUserCache.getPartner does `map.get(id) ?? []`, but the rules
      // engine assumes the batch helper itself populates an entry per
      // requested id so callers can iterate every requested key without a
      // null check. Guard the contract directly.
      const map = await notifications.findPartnerUserIdsBatch([-1, seeded!.partnerOneId]);
      expect(map.get(-1)).toEqual([]);
      expect(map.has(-1)).toBe(true);
      expect(map.get(seeded!.partnerOneId)?.length).toBeGreaterThan(0);
    });

    it("dedupes a user with multiple memberships in the same partner org", async () => {
      // Mirrors the singleton dedupe assertion above. Important because
      // the batch query uses selectDistinct; if that gets dropped a user
      // with two memberships would be notified twice per ticket.
      const map = await notifications.findPartnerUserIdsBatch([seeded!.partnerOneId]);
      const ids = map.get(seeded!.partnerOneId) ?? [];
      const dualOccurrences = ids.filter((id) => id === seeded!.userDualId).length;
      expect(dualOccurrences).toBe(1);
    });

    it("returns an empty map for an empty input list", async () => {
      const map = await notifications.findPartnerUserIdsBatch([]);
      expect(map.size).toBe(0);
    });
  });

  describe("findVendorUserIdsBatch", () => {
    // Symmetric coverage to findPartnerUserIdsBatch — same rules-engine
    // recipient-resolution path, vendor side.
    it("returns memberships for every requested vendor in a single call", async () => {
      const map = await notifications.findVendorUserIdsBatch([
        seeded!.vendorOneId,
        seeded!.vendorTwoId,
        seeded!.vendorThreeId,
      ]);
      expect(new Set(map.get(seeded!.vendorOneId))).toEqual(
        new Set([seeded!.userDId, seeded!.userEId, seeded!.userDualId]),
      );
      expect(map.get(seeded!.vendorTwoId)).toEqual([seeded!.userFId]);
      expect(map.get(seeded!.vendorThreeId)).toEqual([seeded!.userGId]);
    });

    it("includes membership-only users (users.vendor_id NULL) in the result", async () => {
      // The brand-new-user case for vendor recipients. userD/userE/userDual
      // all have only a user_org_memberships row pointing at vendor V1.
      const map = await notifications.findVendorUserIdsBatch([seeded!.vendorOneId]);
      expect(map.get(seeded!.vendorOneId)).toContain(seeded!.userDId);
      expect(map.get(seeded!.vendorOneId)).toContain(seeded!.userEId);
      expect(map.get(seeded!.vendorOneId)).toContain(seeded!.userDualId);
    });

    it("returns an empty array (not undefined) for orgs with no members", async () => {
      const map = await notifications.findVendorUserIdsBatch([-1, seeded!.vendorOneId]);
      expect(map.get(-1)).toEqual([]);
      expect(map.has(-1)).toBe(true);
      expect(map.get(seeded!.vendorOneId)?.length).toBeGreaterThan(0);
    });

    it("dedupes a user with multiple memberships in the same vendor org", async () => {
      const map = await notifications.findVendorUserIdsBatch([seeded!.vendorOneId]);
      const ids = map.get(seeded!.vendorOneId) ?? [];
      const dualOccurrences = ids.filter((id) => id === seeded!.userDualId).length;
      expect(dualOccurrences).toBe(1);
    });

    it("returns an empty map for an empty input list", async () => {
      const map = await notifications.findVendorUserIdsBatch([]);
      expect(map.size).toBe(0);
    });
  });

  describe("findVendorVisitNotifierUserIds", () => {
    it("returns users matched via vendor_people.user_id when the row is role-tagged", async () => {
      const ids = await notifications.findVendorVisitNotifierUserIds(
        seeded!.vendorOneId,
      );
      // userD is linked via vendor_people.user_id and tagged. userE and
      // userDual have no vendor_people row, so they're filtered out.
      expect(ids).toEqual([seeded!.userDId]);
    });

    it("returns users matched via membership.vendor_people_id when the row is role-tagged", async () => {
      const ids = await notifications.findVendorVisitNotifierUserIds(
        seeded!.vendorTwoId,
      );
      // userF's membership carries vendor_people_id pointing at the tagged
      // vendor_people row, even though vendor_people.user_id is NULL.
      expect(ids).toEqual([seeded!.userFId]);
    });

    it("falls back to all vendor users when no vendor_people is role-tagged", async () => {
      const ids = await notifications.findVendorVisitNotifierUserIds(
        seeded!.vendorThreeId,
      );
      // V3 has one member (userG) and no role-tagged vendor_people row,
      // so the helper falls back to findVendorUserIds and returns just
      // userG.
      expect(ids).toEqual([seeded!.userGId]);
    });
  });
});

describe.skipIf(HAVE_DB)("notification recipient helpers (membership-backed)", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used
    // by the unit-test setup; this suite seeds real rows and runs the
    // actual SQL the helpers issue.
  });
});
