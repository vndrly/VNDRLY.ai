// Coverage for the admin-editable demo-account label overrides
// (Task #176). Verifies:
//   • GET /admin/demo-user-labels lists every demo user with the
//     baked-in source defaults and any DB overrides separated out
//   • PUT /admin/demo-user-labels upserts an override and the same
//     override is reflected on a follow-up admin read
//   • PUT with label=null deletes the override row and falls back to
//     the source-of-truth label
//   • Unknown demo usernames are rejected with 404
//   • Non-admins are forbidden from reading or writing overrides
//
// Skips offline (no real DATABASE_URL) the same way the other route
// tests in this directory do.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
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
const MARKER = `demo-labels-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const SPANISH_OVERRIDE = `${MARKER} Súper Admin`;
const TEMP_OVERRIDE = `${MARKER} Temp Override`;

function adminCookie(userId: number): string {
  return buildTestCookie({ userId, role: "admin" });
}
function vendorCookie(userId: number): string {
  return buildTestCookie({ userId, role: "vendor" });
}

const originalNodeEnv = process.env.NODE_ENV;

describe.runIf(haveRealDb)(
  "Admin demo-user label overrides (Task #176)",
  () => {
    beforeAll(async () => {
      process.env.NODE_ENV = "development";
      vi.resetModules();
      dbModule = await import("@workspace/db");
      const router = (await import("./index")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);

      // Fail on conflicting state rather than clearing rows owned elsewhere.
      const existing = await dbModule.db.execute(
        sql`SELECT id FROM demo_user_label_overrides WHERE username = 'admin' AND locale = 'es'`,
      );
      expect(existing.rows).toHaveLength(0);

      const [admin] = await dbModule.db
        .insert(dbModule.usersTable)
        .values({
          username: `${MARKER}-admin@example.com`,
          email: `${MARKER}-admin@example.com`,
          passwordHash: "x",
          displayName: `${MARKER} Admin`,
          role: "admin",
        })
        .returning({ id: dbModule.usersTable.id });
      const [vendor] = await dbModule.db
        .insert(dbModule.usersTable)
        .values({
          username: `${MARKER}-vendor@example.com`,
          email: `${MARKER}-vendor@example.com`,
          passwordHash: "x",
          displayName: `${MARKER} Vendor`,
          role: "vendor",
        })
        .returning({ id: dbModule.usersTable.id });
      adminUserId = admin.id;
      nonAdminUserId = vendor.id;
    }, 30_000);

    afterEach(async () => {
      await dbModule.db.execute(
        sql`DELETE FROM demo_user_label_overrides WHERE username = 'admin' AND locale = 'es' AND label IN (${SPANISH_OVERRIDE}, ${TEMP_OVERRIDE})`,
      );
    });

    afterAll(async () => {
      try {
        await dbModule.db
          .delete(dbModule.usersTable)
          .where(eq(dbModule.usersTable.id, adminUserId));
        await dbModule.db
          .delete(dbModule.usersTable)
          .where(eq(dbModule.usersTable.id, nonAdminUserId));
        await dbModule.db.execute(
          sql`DELETE FROM demo_user_label_overrides WHERE username = 'admin' AND locale = 'es' AND label IN (${SPANISH_OVERRIDE}, ${TEMP_OVERRIDE})`,
        );
      } catch {
        /* best-effort cleanup */
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it("GET returns every demo account with defaults and (initially) no overrides", async () => {
      const res = await request(app)
        .get("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.locales)).toBe(true);
      expect(res.body.locales).toEqual(expect.arrayContaining(["en", "es"]));
      expect(Array.isArray(res.body.entries)).toBe(true);
      const adminEntry = res.body.entries.find(
        (e: { username: string }) => e.username === "admin",
      );
      expect(adminEntry).toBeDefined();
      // Source-of-truth defaults still present.
      expect(adminEntry.defaults.en).toBe("System Admin");
      expect(adminEntry.defaults.es).toBe("Administrador del Sistema");
      // No overrides yet.
      expect(adminEntry.overrides).toEqual({});
    });

    it("PUT upserts an override that surfaces on /auth/demo-users", async () => {
      // Apply a Spanish override for the `admin` demo account.
      const put = await request(app)
        .put("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId))
        .send({ username: "admin", locale: "es", label: SPANISH_OVERRIDE });
      expect(put.status).toBe(200);
      const adminEntry = put.body.entries.find(
        (e: { username: string }) => e.username === "admin",
      );
      expect(adminEntry.overrides.es).toBe(SPANISH_OVERRIDE);

      // The admin read surface should now serve the override while
      // preserving the source defaults for every locale.
      const esRes = await request(app)
        .get("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId));
      expect(esRes.status).toBe(200);
      const esAdmin = esRes.body.entries.find(
        (a: { username: string }) => a.username === "admin",
      );
      expect(esAdmin.overrides.es).toBe(SPANISH_OVERRIDE);
      expect(esAdmin.defaults.en).toBe("System Admin");
    });

    it("PUT with label=null clears the override and falls back to source", async () => {
      // Seed an override directly so we don't rely on the previous test.
      await dbModule.db.execute(
        sql`INSERT INTO demo_user_label_overrides (username, locale, label) VALUES ('admin', 'es', ${TEMP_OVERRIDE})`,
      );

      const cleared = await request(app)
        .put("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId))
        .send({ username: "admin", locale: "es", label: null });
      expect(cleared.status).toBe(200);
      const adminEntry = cleared.body.entries.find(
        (e: { username: string }) => e.username === "admin",
      );
      expect(adminEntry.overrides.es).toBeUndefined();

      // The admin read now shows no override, leaving the source default.
      const res = await request(app)
        .get("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(200);
      const esAdmin = res.body.entries.find(
        (a: { username: string }) => a.username === "admin",
      );
      expect(esAdmin.overrides.es).toBeUndefined();
      expect(esAdmin.defaults.es).toBe("Administrador del Sistema");
    });

    it("rejects unknown demo usernames with 404", async () => {
      const res = await request(app)
        .put("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId))
        .send({ username: "not-a-real-demo", locale: "en", label: "Nope" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("demo_users.unknown_username");
    });

    it("rejects unsupported locales with 400", async () => {
      const res = await request(app)
        .put("/api/admin/demo-user-labels")
        .set("Cookie", adminCookie(adminUserId))
        .send({ username: "admin", locale: "fr", label: "Non" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("demo_users.unsupported_locale");
    });

    it("forbids non-admin GET and PUT", async () => {
      const get = await request(app)
        .get("/api/admin/demo-user-labels")
        .set("Cookie", vendorCookie(nonAdminUserId));
      expect(get.status).toBe(403);
      const put = await request(app)
        .put("/api/admin/demo-user-labels")
        .set("Cookie", vendorCookie(nonAdminUserId))
        .send({ username: "admin", locale: "es", label: "Hola" });
      expect(put.status).toBe(403);
    });
  },
);
