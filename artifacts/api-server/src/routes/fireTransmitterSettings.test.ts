// Coverage for the admin-only IRS FIRE transmitter settings route
// (Task #415). Verifies admin-gating, the same validation the FIRE
// e-file route enforces (every field required + parseable address),
// the audit-log diff written on every change, and the no-op-on-unchanged
// behaviour. The legacy `IRS_FIRE_*` env-var fallback was removed in
// Task #826, so this suite no longer exercises any env-var path.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import pg from "pg";
import { eq } from "drizzle-orm";
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

let dbModule: typeof import("@workspace/db");
let app: express.Express;
let adminUserId: number;
let nonAdminUserId: number;

function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    displayName: "Admin Tester",
  });
}

function vendorCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "vendor",
    displayName: "Vendor Tester",
  });
}

const VALID_BODY = {
  tcc: "AB123",
  ein: "12-3456789",
  name: "Test Transmitter LLC",
  address: "123 Main St, Springfield, IL 62701",
  contactName: "Pat Operator",
  contactEmail: "ops@example.com",
  contactPhone: "555-555-5555",
};

describe.runIf(haveRealDb)(
  "/admin/1099-transmitter-settings (Task #415)",
  () => {
    beforeAll(async () => {
      dbModule = await import("@workspace/db");
      const router = (await import("./index")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);

      // Wipe any prior singleton row + audit rows from earlier runs so
      // each suite starts deterministic; the table is small.
      await dbModule.db.delete(dbModule.fireTransmitterSettingsAuditLogTable);
      await dbModule.db.delete(dbModule.fireTransmitterSettingsTable);

      // Seed an admin and a non-admin user for the gating test. Use
      // unique email markers so we can cleanup safely afterwards.
      const marker = `fts-${Date.now()}`;
      const [admin] = await dbModule.db
        .insert(dbModule.usersTable)
        .values({
          username: `${marker}-admin`,
          email: `${marker}-admin@example.com`,
          passwordHash: "x",
          displayName: "Admin",
          role: "admin",
        })
        .returning({ id: dbModule.usersTable.id });
      const [vendor] = await dbModule.db
        .insert(dbModule.usersTable)
        .values({
          username: `${marker}-vendor`,
          email: `${marker}-vendor@example.com`,
          passwordHash: "x",
          displayName: "Vendor",
          role: "vendor",
        })
        .returning({ id: dbModule.usersTable.id });
      adminUserId = admin.id;
      nonAdminUserId = vendor.id;
    }, 30_000);

    afterAll(async () => {
      await dbModule.db.delete(
        dbModule.fireTransmitterSettingsAuditLogTable,
      );
      await dbModule.db.delete(dbModule.fireTransmitterSettingsTable);
      if (adminUserId) {
        await dbModule.db
          .delete(dbModule.usersTable)
          .where(eq(dbModule.usersTable.id, adminUserId));
      }
      if (nonAdminUserId) {
        await dbModule.db
          .delete(dbModule.usersTable)
          .where(eq(dbModule.usersTable.id, nonAdminUserId));
      }
    });

    it("rejects non-admin callers", async () => {
      const get = await request(app)
        .get(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", vendorCookie(nonAdminUserId));
      expect([401, 403]).toContain(get.status);

      const put = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", vendorCookie(nonAdminUserId))
        .send(VALID_BODY);
      expect([401, 403]).toContain(put.status);
    });

    it("GET reports every field as missing when no row has been saved", async () => {
      const res = await request(app)
        .get(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.tcc).toBeNull();
      expect(res.body.updatedAt).toBeNull();
      // Every column should appear in `missing` since there is no
      // saved row — there is no env-var fallback any more (Task #826).
      const missing = res.body.missing as string[];
      for (const f of [
        "tcc",
        "ein",
        "name",
        "address",
        "contactName",
        "contactEmail",
        "contactPhone",
      ]) {
        expect(missing).toContain(f);
      }
    });

    it("PUT rejects bodies with missing required fields", async () => {
      const res = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ ...VALID_BODY, tcc: "" });
      expect(res.status).toBe(400);
    });

    it("PUT rejects an unparseable address", async () => {
      const res = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ ...VALID_BODY, address: "no commas at all" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("fire_transmitter.invalid");
      expect(res.body.missing).toContain("address");
    });

    it("PUT persists, returns the saved row, and writes an audit row", async () => {
      const res = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId))
        .set("X-Forwarded-For", "10.0.0.7")
        .set("User-Agent", "vitest/1.0")
        .send(VALID_BODY);
      expectStatus(res, 200);
      expect(res.body.tcc).toBe("AB123");
      expect(res.body.ein).toBe("12-3456789");
      expect(res.body.updatedAt).not.toBeNull();
      expect(res.body.updatedByUserId).toBe(adminUserId);
      // #1243 — surface the saving admin's name/email so the UI can
      // render "Last saved … by …" instead of just a timestamp. The
      // beforeAll seed sets displayName="Admin" and a marker email.
      expect(res.body.updatedByName).toBe("Admin");
      expect(typeof res.body.updatedByEmail).toBe("string");
      expect(res.body.updatedByEmail).toContain("-admin@example.com");
      expect(res.body.missing).toEqual([]);

      const audits = await dbModule.db
        .select()
        .from(dbModule.fireTransmitterSettingsAuditLogTable);
      expect(audits.length).toBe(1);
      const audit = audits[0];
      expect(audit.actorUserId).toBe(adminUserId);
      expect(audit.actorRole).toBe("admin");
      expect(audit.actorIp).toBe("10.0.0.7");
      expect(audit.actorUserAgent).toBe("vitest/1.0");
      const changes = audit.changes as Record<
        string,
        { before: string | null; after: string }
      >;
      expect(changes.tcc).toEqual({ before: null, after: "AB123" });
      expect(Object.keys(changes).sort()).toEqual(
        [
          "address",
          "contactEmail",
          "contactName",
          "contactPhone",
          "ein",
          "name",
          "tcc",
        ].sort(),
      );
    });

    it("PUT with no changes does NOT add an audit row", async () => {
      const before = await dbModule.db
        .select()
        .from(dbModule.fireTransmitterSettingsAuditLogTable);
      const res = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId))
        .send(VALID_BODY);
      expectStatus(res, 200);
      const after = await dbModule.db
        .select()
        .from(dbModule.fireTransmitterSettingsAuditLogTable);
      expect(after.length).toBe(before.length);
    });

    it("PUT with one changed field writes an audit row capturing only that field", async () => {
      const beforeCount = (
        await dbModule.db
          .select()
          .from(dbModule.fireTransmitterSettingsAuditLogTable)
      ).length;
      const res = await request(app)
        .put(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId))
        .send({ ...VALID_BODY, contactName: "New Operator" });
      expectStatus(res, 200);
      expect(res.body.contactName).toBe("New Operator");

      const audits = await dbModule.db
        .select()
        .from(dbModule.fireTransmitterSettingsAuditLogTable);
      expect(audits.length).toBe(beforeCount + 1);
      const latest = audits.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      const changes = latest.changes as Record<
        string,
        { before: string | null; after: string }
      >;
      expect(Object.keys(changes)).toEqual(["contactName"]);
      expect(changes.contactName).toEqual({
        before: "Pat Operator",
        after: "New Operator",
      });
    });

    it("GET /history rejects non-admin callers", async () => {
      const res = await request(app)
        .get(`/api/admin/1099-transmitter-settings/history`)
        .set("Cookie", vendorCookie(nonAdminUserId));
      expect([401, 403]).toContain(res.status);
    });

    it("GET /history returns recent changes newest-first with actor + diff", async () => {
      const res = await request(app)
        .get(`/api/admin/1099-transmitter-settings/history`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      // The earlier PUT tests inserted two audit rows (initial save +
      // contactName change). The "no-change" PUT must not have added
      // a row.
      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBe(2);

      // Newest first — the contactName-only change should be first.
      const [first, second] = res.body.items as Array<{
        actorUserId: number | null;
        actorDisplayName: string | null;
        actorEmail: string | null;
        actorRole: string;
        actorIp: string | null;
        actorUserAgent: string | null;
        changes: Record<string, { before: string | null; after: string | null }>;
      }>;
      expect(Object.keys(first.changes)).toEqual(["contactName"]);
      expect(first.changes.contactName).toEqual({
        before: "Pat Operator",
        after: "New Operator",
      });
      expect(first.actorUserId).toBe(adminUserId);
      expect(first.actorRole).toBe("admin");
      // Joined from the users row seeded in beforeAll.
      expect(first.actorDisplayName).toBe("Admin");
      expect(first.actorEmail).toMatch(/-admin@example\.com$/);

      // The original full save should be the older row.
      expect(Object.keys(second.changes).sort()).toContain("tcc");
      expect(second.actorIp).toBe("10.0.0.7");
      expect(second.actorUserAgent).toBe("vitest/1.0");
    });

    it("GET /history clamps limit and respects offset", async () => {
      const res = await request(app)
        .get(`/api/admin/1099-transmitter-settings/history?limit=1&offset=1`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
      expect(res.body.total).toBe(2);
      expect(res.body.items.length).toBe(1);
      // With offset=1, we skip the newest row and get the initial save.
      const [row] = res.body.items;
      expect(Object.keys(row.changes)).toContain("tcc");
    });

    it("GET returns the persisted row after a PUT", async () => {
      const res = await request(app)
        .get(`/api/admin/1099-transmitter-settings`)
        .set("Cookie", adminCookie(adminUserId));
      expectStatus(res, 200);
      expect(res.body.tcc).toBe("AB123");
      expect(res.body.contactName).toBe("New Operator");
      expect(res.body.missing).toEqual([]);
      // #1243 — GET joins users.display_name / users.email for the
      // admin who last saved the row so the "Last saved by" line on
      // the admin card has both fields available.
      expect(res.body.updatedByUserId).toBe(adminUserId);
      expect(res.body.updatedByName).toBe("Admin");
      expect(res.body.updatedByEmail).toContain("-admin@example.com");
    });
  },
);
