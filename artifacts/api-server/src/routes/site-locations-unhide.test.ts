import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { sql, eq } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// Tests for the admin-only "un-hide / restore superseded site" toggle on
// PATCH /site-locations/:id. The well-ingestion pipeline marks broad
// county-area anchors as hidden=true once real wells are inserted for
// the operator; this endpoint is the only path an admin has to reverse
// that decision (formerly required direct DB access).



function expFuture(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60;
}

function adminCookie(userId: number) {
  return buildTestCookie({
    userId,
    role: "admin",
    partnerId: null,
    vendorId: null,
    exp: expFuture(),
  });
}

function partnerCookie(userId: number, partnerId: number) {
  return buildTestCookie({
    userId,
    role: "partner",
    partnerId,
    vendorId: null,
    membershipRole: "admin",
    exp: expFuture(),
  });
}

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

const MARKER = `unhide-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let app: express.Express;
let dbModule: typeof import("@workspace/db");
let seededPartnerId: number;
let hiddenSiteId: number;
let visibleSiteId: number;
let adminUserId: number;
let partnerUserId: number;

const describeIfDb = haveRealDb ? describe : describe.skip;

describeIfDb("PATCH /site-locations/:id — un-hide admin override", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    const siteLocations = await import("./siteLocations");

    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(siteLocations.default);
    attachTestErrorMiddleware(app);

    const { db, partnersTable, siteLocationsTable, usersTable } = dbModule;

    const [partner] = await db
      .insert(partnersTable)
      .values({
        name: `${MARKER}-partner`,
        contactName: "P",
        contactEmail: `${MARKER}-p@example.com`,
      })
      .returning({ id: partnersTable.id });
    seededPartnerId = partner.id;

    const [admin] = await db
      .insert(usersTable)
      .values({
        username: `${MARKER}-admin@example.com`,
        passwordHash: "x",
        role: "admin",
        displayName: "Admin Tester",
      })
      .returning({ id: usersTable.id });
    adminUserId = admin.id;

    const [pUser] = await db
      .insert(usersTable)
      .values({
        username: `${MARKER}-partneru@example.com`,
        passwordHash: "x",
        role: "partner",
        displayName: "Partner Tester",
      })
      .returning({ id: usersTable.id });
    partnerUserId = pUser.id;

    const [hidden] = await db
      .insert(siteLocationsTable)
      .values({
        partnerId: seededPartnerId,
        name: `${MARKER}-hidden`,
        address: "OK County Anchor",
        latitude: 35.5,
        longitude: -97.5,
        siteCode: `${MARKER}-H`,
        hidden: true,
        sourceType: "area-anchor",
        supersededAt: new Date("2026-04-01T00:00:00Z"),
      })
      .returning({ id: siteLocationsTable.id });
    hiddenSiteId = hidden.id;

    const [visible] = await db
      .insert(siteLocationsTable)
      .values({
        partnerId: seededPartnerId,
        name: `${MARKER}-visible`,
        address: "Real well",
        latitude: 35.6,
        longitude: -97.6,
        siteCode: `${MARKER}-V`,
        hidden: false,
        sourceType: "manual",
      })
      .returning({ id: siteLocationsTable.id });
    visibleSiteId = visible.id;
  });

  afterAll(async () => {
    if (!haveRealDb) return;
    const { db } = dbModule;

    const siteIds = [hiddenSiteId, visibleSiteId].filter(
      (id): id is number => typeof id === "number",
    );
    const userIds = [adminUserId, partnerUserId].filter(
      (id): id is number => typeof id === "number",
    );

    if (siteIds.length > 0) {
      await db.execute(
        sql`DELETE FROM site_location_admin_audit_log WHERE site_location_id IN ${sql.raw(`(${siteIds.join(",")})`)}`,
      );
      await db.execute(
        sql`DELETE FROM site_locations WHERE id IN ${sql.raw(`(${siteIds.join(",")})`)}`,
      );
    }
    if (typeof seededPartnerId === "number") {
      await db.execute(sql`DELETE FROM partners WHERE id = ${seededPartnerId}`);
    }
    if (userIds.length > 0) {
      await db.execute(
        sql`DELETE FROM users WHERE id IN ${sql.raw(`(${userIds.join(",")})`)}`,
      );
    }
  });

  it("admin un-hide clears supersededAt and writes an audit row", async () => {
    const { db, siteLocationsTable, siteLocationAdminAuditLogTable } = dbModule;

    const res = await request(app)
      .patch(`/site-locations/${hiddenSiteId}`)
      .set("Cookie", adminCookie(adminUserId))
      .send({ hidden: false });
    expectStatus(res, 200);

    const [row] = await db
      .select()
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, hiddenSiteId));
    expect(row.hidden).toBe(false);
    expect(row.supersededAt).toBeNull();

    const audits = await db
      .select()
      .from(siteLocationAdminAuditLogTable)
      .where(eq(siteLocationAdminAuditLogTable.siteLocationId, hiddenSiteId));
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe("unhide");
    expect(audits[0].actorUserId).toBe(adminUserId);
    expect(audits[0].actorRole).toBe("admin");
    type ChangePair<T> = { before: T; after: T };
    const changes = audits[0].changes as {
      hidden: ChangePair<boolean>;
      supersededAt: ChangePair<string | null>;
    };
    expect(changes.hidden).toEqual({ before: true, after: false });
    expect(changes.supersededAt.before).not.toBeNull();
    expect(changes.supersededAt.after).toBeNull();
  });

  it("partner cannot toggle hidden even on a site they own", async () => {
    const res = await request(app)
      .patch(`/site-locations/${visibleSiteId}`)
      .set("Cookie", partnerCookie(partnerUserId, seededPartnerId))
      .send({ hidden: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("site_location.admin_only_toggle_hidden");

    const { db, siteLocationsTable } = dbModule;
    const [row] = await db
      .select()
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, visibleSiteId));
    expect(row.hidden).toBe(false);
  });

  it("does not write an audit row when other fields update without hidden change", async () => {
    const { db, siteLocationAdminAuditLogTable } = dbModule;

    const before = await db
      .select()
      .from(siteLocationAdminAuditLogTable)
      .where(eq(siteLocationAdminAuditLogTable.siteLocationId, visibleSiteId));

    const res = await request(app)
      .patch(`/site-locations/${visibleSiteId}`)
      .set("Cookie", adminCookie(adminUserId))
      .send({ afe: "AFE-2026-TEST" });
    expectStatus(res, 200);

    const after = await db
      .select()
      .from(siteLocationAdminAuditLogTable)
      .where(eq(siteLocationAdminAuditLogTable.siteLocationId, visibleSiteId));
    expect(after.length).toBe(before.length);
  });

  it("GET /site-locations/:id exposes hidden, supersededAt, sourceType for admins", async () => {
    const { db, siteLocationsTable } = dbModule;
    // Hide visibleSiteId so we can verify both fields are reported.
    await db
      .update(siteLocationsTable)
      .set({ hidden: true, supersededAt: new Date("2026-03-15T00:00:00Z") })
      .where(eq(siteLocationsTable.id, visibleSiteId));

    const res = await request(app)
      .get(`/site-locations/${visibleSiteId}`)
      .set("Cookie", adminCookie(adminUserId));
    expectStatus(res, 200);
    expect(res.body.hidden).toBe(true);
    expect(res.body.supersededAt).toBe("2026-03-15T00:00:00.000Z");
    expect(typeof res.body.sourceType).toBe("string");
  });
});
