// Integration test for the admin vendor-merge audit log readout
// (Task #453). Mounts the real `vendors` router against the real DB
// when one is reachable and verifies:
//   • non-admin sessions are 403'd on both list + detail endpoints
//   • the list returns rows newest-first with the join-resolved
//     `actorDisplayName` and the summary projection (no `counts` /
//     `loserSnapshot` jsonb in the list response — those only show up
//     on the detail endpoint, by design)
//   • `limit` / `offset` query params clamp + page correctly
//   • the detail endpoint returns the `counts` map and the verbatim
//     `loserSnapshot` jsonb that was stored at merge time
//   • a missing `id` is a 404
//
// Like `vendors-create-duplicate.test.ts`, this skips with a no-op
// `describe.runIf(haveRealDb)` when there is no usable DATABASE_URL,
// so the unit suite still runs in offline CI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { eq, inArray } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

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

const MARKER = `vmerge-route-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

function partnerCookie(): string {
  return buildTestCookie({
    userId: 999_999,
    role: "partner",
    vendorId: null,
    partnerId: 1,
  });
}

describe.runIf(haveRealDb)(
  "GET /api/admin/vendor-merges (Task #453)",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    const createdAuditIds: number[] = [];
    const createdSurvivorIds: number[] = [];
    const createdAdminIds: number[] = [];

    let adminUserId = 0;

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./vendors")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);

      // Seed an admin user so the join in the list endpoint can
      // resolve `actorDisplayName` without us depending on whatever
      // happens to live in `users` already.
      const [admin] = await db
        .insert(s.usersTable)
        .values({
          username: `${MARKER}-admin`,
          passwordHash: "x",
          role: "admin",
          displayName: `${MARKER} Admin`,
        })
        .returning({ id: s.usersTable.id });
      adminUserId = admin.id;
      createdAdminIds.push(admin.id);

      // Seed a couple of survivor vendors to FK against. Loser ids
      // are bare integers (no FK in the audit table), so we don't
      // need real vendor rows for the loser side.
      for (let i = 0; i < 2; i++) {
        const [v] = await db
          .insert(s.vendorsTable)
          .values({
            name: `${MARKER}-survivor-${i}`,
            contactName: "Survivor",
            contactEmail: `${MARKER}-survivor-${i}@example.com`,
          })
          .returning({ id: s.vendorsTable.id });
        createdSurvivorIds.push(v.id);
      }

      // Seed three audit log rows with deterministic-but-distinct
      // createdAt timestamps so the newest-first ordering assertion
      // is unambiguous.
      const baseTime = Date.now();
      for (let i = 0; i < 3; i++) {
        const [row] = await db
          .insert(s.vendorMergeAuditLogTable)
          .values({
            survivorVendorId: createdSurvivorIds[i % createdSurvivorIds.length],
            survivorVendorName: `${MARKER}-survivor-${i % createdSurvivorIds.length}`,
            loserVendorId: 90_000_000 + i,
            loserVendorName: `${MARKER}-loser-${i}`,
            loserSnapshot: {
              name: `${MARKER}-loser-${i}`,
              contactName: "Old Owner",
              contactEmail: `${MARKER}-loser-${i}@example.com`,
              federalTaxId: `00-000${i}000`,
            },
            counts: {
              tickets: { move: i + 1, conflictDelete: 0 },
              invoices: { move: 0, conflictDelete: i },
            },
            totalMoved: i + 1,
            totalConflictDeleted: i,
            actorUserId: adminUserId,
            actorRole: "admin",
            actorIp: "10.0.0.5",
            actorUserAgent: "vitest-suite/1.0",
            // Force ascending createdAt so row index 2 is newest.
            createdAt: new Date(baseTime + i * 1000),
          })
          .returning({ id: s.vendorMergeAuditLogTable.id });
        createdAuditIds.push(row.id);
      }
    });

    afterAll(async () => {
      if (createdAuditIds.length) {
        await db
          .delete(s.vendorMergeAuditLogTable)
          .where(inArray(s.vendorMergeAuditLogTable.id, createdAuditIds));
      }
      for (const id of createdSurvivorIds) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, id));
      }
      for (const id of createdAdminIds) {
        await db.delete(s.usersTable).where(eq(s.usersTable.id, id));
      }
    });

    it("403s a partner session on the list endpoint", async () => {
      const res = await request(app)
        .get("/api/admin/vendor-merges")
        .set("Cookie", partnerCookie());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_required");
    });

    it("401s an unauthenticated caller on the list endpoint", async () => {
      const res = await request(app).get("/api/admin/vendor-merges");
      expect(res.status).toBe(401);
    });

    it("returns the seeded rows newest-first with join-resolved actor name", async () => {
      const res = await request(app)
        .get("/api/admin/vendor-merges")
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(typeof res.body.total).toBe("number");
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
      expect(Array.isArray(res.body.items)).toBe(true);

      // Filter to just the rows this test seeded so we can make
      // ordering assertions in the presence of any pre-existing
      // audit history on the test DB.
      const ours = res.body.items.filter((r: { loserVendorName: string }) =>
        r.loserVendorName.startsWith(MARKER),
      );
      expect(ours.length).toBe(3);

      // We seeded with ascending createdAt — the API orders by
      // createdAt DESC, so the loser names should come back as
      // 2 → 1 → 0 within our slice (independent of where they fall
      // in the global ordering).
      const loserSuffixes = ours.map(
        (r: { loserVendorName: string }) =>
          r.loserVendorName.split("-loser-")[1],
      );
      expect(loserSuffixes).toEqual(["2", "1", "0"]);

      // Summary projection: the heavy jsonb fields must NOT be in
      // the list response; the join-resolved actor display name
      // must be present.
      for (const item of ours) {
        expect(item).not.toHaveProperty("counts");
        expect(item).not.toHaveProperty("loserSnapshot");
        expect(item.actorDisplayName).toBe(`${MARKER} Admin`);
        expect(item.actorRole).toBe("admin");
        expect(typeof item.totalMoved).toBe("number");
        expect(typeof item.totalConflictDeleted).toBe("number");
      }
    });

    it("respects limit + offset for paging", async () => {
      const all = await request(app)
        .get("/api/admin/vendor-merges?limit=200&offset=0")
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(all, 200);
      const oursAll = all.body.items.filter((r: { loserVendorName: string }) =>
        r.loserVendorName.startsWith(MARKER),
      );
      expect(oursAll.length).toBe(3);

      // Use a focused offset query: skip the freshly-seeded rows
      // before our marker rows. We can verify paging consistency by
      // fetching limit=1 multiple times and concatenating.
      const page1 = await request(app)
        .get("/api/admin/vendor-merges?limit=1&offset=0")
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(page1, 200);
      expect(page1.body.limit).toBe(1);
      expect(page1.body.items.length).toBe(1);

      const page2 = await request(app)
        .get("/api/admin/vendor-merges?limit=1&offset=1")
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(page2, 200);
      expect(page2.body.offset).toBe(1);
      expect(page2.body.items.length).toBe(1);

      // The two pages must return distinct rows.
      expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
    });

    it("clamps an over-large limit to the route maximum", async () => {
      const res = await request(app)
        .get("/api/admin/vendor-merges?limit=99999")
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.limit).toBe(200);
    });

    // Task #829 — search + filter parameters.
    it("filters by case-insensitive vendor name substring (q)", async () => {
      // Match the loser-name pattern shared by all 3 seeded rows.
      const res = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-LOSER")}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.items.length).toBe(3);
      expect(res.body.total).toBe(3);
      for (const item of res.body.items) {
        expect(item.loserVendorName.startsWith(MARKER)).toBe(true);
      }

      // Match a single specific loser (suffix `-loser-1`).
      const one = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-1")}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(one, 200);
      expect(one.body.items.length).toBe(1);
      expect(one.body.total).toBe(1);
      expect(one.body.items[0].loserVendorName).toBe(`${MARKER}-loser-1`);
    });

    it("matches against the survivor name as well as the loser name", async () => {
      const res = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-survivor-0")}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      // Two of the three seeded rows survivor-pointed at index 0.
      const ours = res.body.items.filter(
        (r: { loserVendorName: string }) => r.loserVendorName.startsWith(MARKER),
      );
      expect(ours.length).toBe(2);
    });

    it("treats LIKE wildcards in q as literal characters", async () => {
      // `%` in user input must NOT act as a wildcard; otherwise this
      // would incorrectly return our seeded rows.
      const res = await request(app)
        .get(`/api/admin/vendor-merges?q=${encodeURIComponent("%")}`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      const ours = res.body.items.filter(
        (r: { loserVendorName: string }) => r.loserVendorName.startsWith(MARKER),
      );
      expect(ours.length).toBe(0);
    });

    it("filters by actorUserId", async () => {
      const res = await request(app)
        .get(`/api/admin/vendor-merges?actorUserId=${adminUserId}`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      // Every returned row must be attributed to the seeded admin.
      for (const item of res.body.items) {
        expect(item.actorUserId).toBe(adminUserId);
      }
      // And our 3 seeded rows must be in the result set.
      const ours = res.body.items.filter(
        (r: { loserVendorName: string }) => r.loserVendorName.startsWith(MARKER),
      );
      expect(ours.length).toBe(3);

      // A bogus actor id returns no rows.
      const none = await request(app)
        .get(`/api/admin/vendor-merges?actorUserId=999000111`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(none, 200);
      expect(none.body.total).toBe(0);
      expect(none.body.items.length).toBe(0);
    });

    it("filters by createdFrom / createdTo date range", async () => {
      // Pull our seeded rows back to learn their exact createdAt
      // timestamps (the DB may round to microseconds).
      const all = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-")}&limit=200`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(all, 200);
      const sorted = [...all.body.items].sort(
        (a: { createdAt: string }, b: { createdAt: string }) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      expect(sorted.length).toBe(3);
      const firstAt = sorted[0].createdAt as string;
      const lastAt = sorted[2].createdAt as string;

      // createdFrom = second row's createdAt should drop the oldest.
      const fromMid = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-")}&createdFrom=${encodeURIComponent(sorted[1].createdAt)}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(fromMid, 200);
      expect(fromMid.body.total).toBe(2);

      // createdTo = first row's createdAt should keep only the oldest.
      const toFirst = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-")}&createdTo=${encodeURIComponent(firstAt)}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(toFirst, 200);
      expect(toFirst.body.total).toBe(1);

      // Combining from/to keeps the middle slice.
      const both = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-")}&createdFrom=${encodeURIComponent(sorted[1].createdAt)}&createdTo=${encodeURIComponent(lastAt)}`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(both, 200);
      expect(both.body.total).toBe(2);

      // Garbage date strings are treated as "no filter" (don't 400).
      const bad = await request(app)
        .get(
          `/api/admin/vendor-merges?q=${encodeURIComponent(MARKER + "-loser-")}&createdFrom=not-a-date`,
        )
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(bad, 200);
      expect(bad.body.total).toBe(3);
    });
  },
);

describe.runIf(haveRealDb)(
  "GET /api/admin/vendor-merges/:id (Task #453)",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    let auditId = 0;
    let adminUserId = 0;
    let survivorId = 0;
    const createdAdminIds: number[] = [];

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./vendors")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);

      const [admin] = await db
        .insert(s.usersTable)
        .values({
          username: `${MARKER}-detail-admin`,
          passwordHash: "x",
          role: "admin",
          displayName: `${MARKER} Detail Admin`,
        })
        .returning({ id: s.usersTable.id });
      adminUserId = admin.id;
      createdAdminIds.push(admin.id);

      const [survivor] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-detail-survivor`,
          contactName: "Survivor",
          contactEmail: `${MARKER}-detail-survivor@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      survivorId = survivor.id;

      const [row] = await db
        .insert(s.vendorMergeAuditLogTable)
        .values({
          survivorVendorId: survivorId,
          survivorVendorName: `${MARKER}-detail-survivor`,
          loserVendorId: 80_000_001,
          loserVendorName: `${MARKER}-detail-loser`,
          loserSnapshot: {
            name: `${MARKER}-detail-loser`,
            contactName: "Captured Owner",
            contactEmail: "captured@example.com",
            federalTaxId: "12-3456789",
            stateTaxId: "ST-987",
            physicalAddress: "1 Audit Way",
            // Intentionally exotic field so we can prove the
            // detail response forwards arbitrary jsonb verbatim.
            extras: { color: "amber", legacyFlag: true },
          },
          counts: {
            tickets: { move: 7, conflictDelete: 1 },
            invoices: { move: 2, conflictDelete: 0 },
          },
          totalMoved: 9,
          totalConflictDeleted: 1,
          actorUserId: adminUserId,
          actorRole: "admin",
          actorIp: "10.0.0.42",
          actorUserAgent: "vitest-detail/1.0",
        })
        .returning({ id: s.vendorMergeAuditLogTable.id });
      auditId = row.id;
    });

    afterAll(async () => {
      if (auditId) {
        await db
          .delete(s.vendorMergeAuditLogTable)
          .where(eq(s.vendorMergeAuditLogTable.id, auditId));
      }
      if (survivorId) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, survivorId));
      }
      for (const id of createdAdminIds) {
        await db.delete(s.usersTable).where(eq(s.usersTable.id, id));
      }
    });

    it("403s a partner session on the detail endpoint", async () => {
      const res = await request(app)
        .get(`/api/admin/vendor-merges/${auditId}`)
        .set("Cookie", partnerCookie());
      expect(res.status).toBe(403);
    });

    it("returns the full row with counts + loserSnapshot + actor name", async () => {
      const res = await request(app)
        .get(`/api/admin/vendor-merges/${auditId}`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.id).toBe(auditId);
      expect(res.body.survivorVendorId).toBe(survivorId);
      expect(res.body.survivorVendorName).toBe(`${MARKER}-detail-survivor`);
      expect(res.body.loserVendorId).toBe(80_000_001);
      expect(res.body.loserVendorName).toBe(`${MARKER}-detail-loser`);
      expect(res.body.totalMoved).toBe(9);
      expect(res.body.totalConflictDeleted).toBe(1);
      expect(res.body.actorDisplayName).toBe(`${MARKER} Detail Admin`);
      expect(res.body.actorIp).toBe("10.0.0.42");
      expect(res.body.actorUserAgent).toBe("vitest-detail/1.0");
      expect(res.body.counts).toEqual({
        tickets: { move: 7, conflictDelete: 1 },
        invoices: { move: 2, conflictDelete: 0 },
      });
      // Verbatim jsonb forwarding — including the intentionally
      // exotic nested object.
      expect(res.body.loserSnapshot.federalTaxId).toBe("12-3456789");
      expect(res.body.loserSnapshot.extras).toEqual({
        color: "amber",
        legacyFlag: true,
      });
      // ISO-formatted timestamp.
      expect(typeof res.body.createdAt).toBe("string");
      expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
      // Task #822: the detail endpoint pre-flights the same loser-id
      // collision check the revert endpoint uses, so the admin UI can
      // hide / disable the "Revert this merge" button. The seeded
      // loser id (80_000_001) is well above any real vendor id, so
      // the detail endpoint must report it as available with no
      // conflicting vendor.
      expect(res.body.loserIdAvailable).toBe(true);
      expect(res.body.conflictingVendor).toBeNull();
    });

    it("reports loserIdAvailable=false when the loser id is occupied", async () => {
      // Insert a vendor that occupies the loser's original id so the
      // pre-flight check has something to report. We use a fresh audit
      // row + survivor vendor so the rest of the suite isn't affected.
      const [survivor2] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-detail-survivor-2`,
          contactName: "Survivor",
          contactEmail: `${MARKER}-detail-survivor-2@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      const [squatter] = await db
        .insert(s.vendorsTable)
        .values({
          name: `${MARKER}-detail-squatter`,
          contactName: "Squatter",
          contactEmail: `${MARKER}-detail-squatter@example.com`,
        })
        .returning({ id: s.vendorsTable.id, name: s.vendorsTable.name });
      const [audit2] = await db
        .insert(s.vendorMergeAuditLogTable)
        .values({
          survivorVendorId: survivor2.id,
          survivorVendorName: `${MARKER}-detail-survivor-2`,
          // Reuse the squatter's id as the audit's loser id so the
          // pre-flight collision check fires.
          loserVendorId: squatter.id,
          loserVendorName: `${MARKER}-detail-loser-2`,
          loserSnapshot: {
            id: squatter.id,
            name: `${MARKER}-detail-loser-2`,
          },
          counts: {},
          totalMoved: 0,
          totalConflictDeleted: 0,
          actorUserId: adminUserId,
          actorRole: "admin",
        })
        .returning({ id: s.vendorMergeAuditLogTable.id });
      try {
        const res = await request(app)
          .get(`/api/admin/vendor-merges/${audit2.id}`)
          .set("Cookie", adminCookie(adminUserId));
        expectStatus(res, 200);
        expect(res.body.loserIdAvailable).toBe(false);
        expect(res.body.conflictingVendor).toEqual({
          id: squatter.id,
          name: squatter.name,
        });
      } finally {
        await db
          .delete(s.vendorMergeAuditLogTable)
          .where(eq(s.vendorMergeAuditLogTable.id, audit2.id));
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, squatter.id));
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, survivor2.id));
      }
    });

    it("404s when the audit row does not exist", async () => {
      const res = await request(app)
        .get(`/api/admin/vendor-merges/999000111`)
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("vendor_merge_audit.not_found");
    });

    it("400s on a non-integer id", async () => {
      const res = await request(app)
        .get(`/api/admin/vendor-merges/not-a-number`)
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("vendor_merge_audit.invalid_id");
    });
  },
);
