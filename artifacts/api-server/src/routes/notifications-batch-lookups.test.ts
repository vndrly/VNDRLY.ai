// Coverage for the batched org→userId helpers used by the rules engine
// (Task #49). Asserts that the batched lookups return exactly the same
// users for each org as the legacy single-org lookups, so swapping the
// rules engine to use IN-queries is a behavior-preserving optimization.
//
// Skips offline (no real DATABASE_URL) the same way the other route
// tests in this directory do.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
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

let dbModule: typeof import("@workspace/db");
let notifications: typeof import("./notifications");

const MARKER = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const partnerIds: number[] = [];
const vendorIds: number[] = [];
const userIds: number[] = [];

describe.runIf(haveRealDb)(
  "findVendorUserIdsBatch / findPartnerUserIdsBatch (Task #49)",
  () => {
    beforeAll(async () => {
      dbModule = await import("@workspace/db");
      notifications = await import("./notifications");

      // Three vendors + three partners, with a varying number of users per
      // org (including one org with zero users to exercise the "missing"
      // path).
      for (let i = 0; i < 3; i++) {
        const [v] = await dbModule.db
          .insert(dbModule.vendorsTable)
          .values({
            name: `${MARKER}-v${i}`,
            contactName: `${MARKER}-v${i}-contact`,
            contactEmail: `${MARKER}-v${i}@example.com`,
            contactPhone: "555-0100",
          })
          .returning({ id: dbModule.vendorsTable.id });
        vendorIds.push(v.id);
        const [p] = await dbModule.db
          .insert(dbModule.partnersTable)
          .values({
            name: `${MARKER}-p${i}`,
            contactName: `${MARKER}-p${i}-contact`,
            contactEmail: `${MARKER}-p${i}@example.com`,
            contactPhone: "555-0200",
          })
          .returning({ id: dbModule.partnersTable.id });
        partnerIds.push(p.id);
      }

      // Vendor 0: 2 users (one of whom is ALSO partner 0's only user, so
      //   the cross-membership case is real and not just commented).
      // Vendor 1: 1 user; vendor 2: 0 users.
      // Partner 0: 1 user (the cross-member); partner 1: 2 users;
      // partner 2: 0 users.
      // The cross-membership catches accidental org-type mixups in the
      // batch query's WHERE clause.
      const usersPlan: Array<{ partnerIdx: number | null; vendorIdx: number | null }> = [
        { vendorIdx: 0, partnerIdx: 0 },
        { vendorIdx: 0, partnerIdx: null },
        { vendorIdx: 1, partnerIdx: null },
        { vendorIdx: null, partnerIdx: 1 },
        { vendorIdx: null, partnerIdx: 1 },
      ];

      for (let i = 0; i < usersPlan.length; i++) {
        const username = `${MARKER}-u${i}@example.com`;
        const [u] = await dbModule.db
          .insert(dbModule.usersTable)
          .values({
            username,
            email: username,
            passwordHash: "x",
            displayName: `${MARKER} u${i}`,
            role: "vendor",
          })
          .returning({ id: dbModule.usersTable.id });
        userIds.push(u.id);

        const plan = usersPlan[i];
        if (plan.vendorIdx !== null) {
          await dbModule.db.insert(dbModule.userOrgMembershipsTable).values({
            userId: u.id,
            orgType: "vendor",
            vendorId: vendorIds[plan.vendorIdx],
            role: "member",
          });
        }
        if (plan.partnerIdx !== null) {
          await dbModule.db.insert(dbModule.userOrgMembershipsTable).values({
            userId: u.id,
            orgType: "partner",
            partnerId: partnerIds[plan.partnerIdx],
            role: "member",
          });
        }
      }
    });

    afterAll(async () => {
      // Membership rows cascade with users; users get cleaned up directly.
      // Vendors / partners are also cascaded by the FK on memberships.
      if (userIds.length) {
        await dbModule.db
          .delete(dbModule.usersTable)
          .where(inArray(dbModule.usersTable.id, userIds));
      }
      if (vendorIds.length) {
        await dbModule.db
          .delete(dbModule.vendorsTable)
          .where(inArray(dbModule.vendorsTable.id, vendorIds));
      }
      if (partnerIds.length) {
        await dbModule.db
          .delete(dbModule.partnersTable)
          .where(inArray(dbModule.partnersTable.id, partnerIds));
      }
    });

    it("vendor batch matches per-vendor lookups", async () => {
      const batch = await notifications.findVendorUserIdsBatch(vendorIds);
      for (const vid of vendorIds) {
        const single = await notifications.findVendorUserIds(vid);
        expect((batch.get(vid) ?? []).slice().sort()).toEqual(single.slice().sort());
      }
      // Empty input is a no-op, not an error.
      expect((await notifications.findVendorUserIdsBatch([])).size).toBe(0);
      // Unknown ids come back as empty arrays so callers can use `?? []`.
      const unknown = await notifications.findVendorUserIdsBatch([-1, -2]);
      expect(unknown.get(-1)).toEqual([]);
      expect(unknown.get(-2)).toEqual([]);
    });

    it("partner batch matches per-partner lookups", async () => {
      const batch = await notifications.findPartnerUserIdsBatch(partnerIds);
      for (const pid of partnerIds) {
        const single = await notifications.findPartnerUserIds(pid);
        expect((batch.get(pid) ?? []).slice().sort()).toEqual(single.slice().sort());
      }
    });

    it("vendor batch does not leak partner-org users (and vice versa)", async () => {
      // Vendor 0 has 2 vendor users; partner 0 has 1 partner user.
      // Even though they belong to the same physical orgs in different
      // rows, the batched query must still partition by org_type.
      const vBatch = await notifications.findVendorUserIdsBatch(vendorIds);
      const pBatch = await notifications.findPartnerUserIdsBatch(partnerIds);
      expect((vBatch.get(vendorIds[0]) ?? []).length).toBe(2);
      expect((vBatch.get(vendorIds[1]) ?? []).length).toBe(1);
      expect((vBatch.get(vendorIds[2]) ?? []).length).toBe(0);
      expect((pBatch.get(partnerIds[0]) ?? []).length).toBe(1);
      expect((pBatch.get(partnerIds[1]) ?? []).length).toBe(2);
      expect((pBatch.get(partnerIds[2]) ?? []).length).toBe(0);
    });
  },
);
