// Coverage for the QuickBooks bulk-action retention audit trail
// (Task #799). Verifies:
//   • PATCH writes a `platform_settings_audit_log` row when the
//     qbBulkActionRetentionDays value actually changes
//   • PATCH does NOT write an audit row when the same value is sent
//     (no-op save)
//   • PATCH does NOT write an audit row when the field is absent from
//     the request body (other-field-only updates don't pollute the
//     QB-retention timeline)
//   • GET resolves the most recent audit row + the actor's display
//     name into `qbBulkActionRetentionLastChange`
//   • GET returns `qbBulkActionRetentionLastChange: null` when the
//     setting has never been customized
//
// Skips offline (no DATABASE_URL) the same way the other route tests do.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
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
let adminDisplayName: string;
let nonAdminUserId: number;

const MARKER = `pset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function adminCookie(userId: number): string {
  return buildTestCookie({ userId, role: "admin" });
}

function vendorCookie(userId: number): string {
  return buildTestCookie({ userId, role: "vendor" });
}

describe.runIf(haveRealDb)(
  "/platform-settings retention audit (Task #799)",
  () => {
    beforeAll(async () => {
      dbModule = await import("@workspace/db");
      const router = (await import("./index")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);

      // Wipe ONLY the QB-retention audit rows. Other audited fields
      // (none today, but the table is shared by design) stay intact.
      await dbModule.db
        .delete(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      // Reset the override to null so the suite starts from "never
      // customized". The singleton row may already exist from prior
      // app boot; an UPDATE is a no-op if it doesn't.
      await dbModule.db
        .update(dbModule.platformSettingsTable)
        .set({ qbBulkActionRetentionDays: null })
        .where(eq(dbModule.platformSettingsTable.id, 1));

      adminDisplayName = `${MARKER} Admin`;
      const [admin] = await dbModule.db
        .insert(dbModule.usersTable)
        .values({
          username: `${MARKER}-admin@example.com`,
          email: `${MARKER}-admin@example.com`,
          passwordHash: "x",
          displayName: adminDisplayName,
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

    afterAll(async () => {
      try {
        await dbModule.db
          .delete(dbModule.platformSettingsAuditLogTable)
          .where(
            eq(
              dbModule.platformSettingsAuditLogTable.field,
              "qbBulkActionRetentionDays",
            ),
          );
        await dbModule.db
          .update(dbModule.platformSettingsTable)
          .set({ qbBulkActionRetentionDays: null })
          .where(eq(dbModule.platformSettingsTable.id, 1));
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
      } catch {
        /* best-effort cleanup */
      }
    });

    it("GET reports `qbBulkActionRetentionLastChange: null` when never customized", async () => {
      const res = await request(app)
        .get("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("qbBulkActionRetentionLastChange");
      expect(res.body.qbBulkActionRetentionLastChange).toBeNull();
    });

    it("PATCH from null → 14 writes one audit row and PATCH-response includes it", async () => {
      const beforeCount = (
        await dbModule.db
          .select()
          .from(dbModule.platformSettingsAuditLogTable)
          .where(
            eq(
              dbModule.platformSettingsAuditLogTable.field,
              "qbBulkActionRetentionDays",
            ),
          )
      ).length;

      const res = await request(app)
        .patch("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId))
        .send({ qbBulkActionRetentionDays: 14 });
      expect(res.status).toBe(200);
      expect(res.body.qbBulkActionRetentionDays).toBe(14);
      expect(res.body.qbBulkActionRetentionLastChange).toMatchObject({
        actorUserId: adminUserId,
        actorDisplayName: adminDisplayName,
        actorRole: "admin",
        prevValue: null,
        newValue: "14",
      });
      expect(typeof res.body.qbBulkActionRetentionLastChange.changedAt).toBe(
        "string",
      );

      const after = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      expect(after.length).toBe(beforeCount + 1);
    });

    it("PATCH with the same value (14 → 14) does NOT write an audit row", async () => {
      const before = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      const res = await request(app)
        .patch("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId))
        .send({ qbBulkActionRetentionDays: 14 });
      expect(res.status).toBe(200);
      const after = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      expect(after.length).toBe(before.length);
    });

    it("PATCH that omits the retention field does NOT write an audit row", async () => {
      const before = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      const res = await request(app)
        .patch("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId))
        .send({ blurb: `${MARKER}-test-blurb` });
      expect(res.status).toBe(200);
      const after = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      expect(after.length).toBe(before.length);
    });

    it("PATCH from 14 → null (clear-the-override) writes a new audit row", async () => {
      const res = await request(app)
        .patch("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId))
        .send({ qbBulkActionRetentionDays: null });
      expect(res.status).toBe(200);
      expect(res.body.qbBulkActionRetentionDays).toBeNull();
      expect(res.body.qbBulkActionRetentionLastChange).toMatchObject({
        prevValue: "14",
        newValue: null,
        actorUserId: adminUserId,
      });
    });

    it("GET surfaces the most-recent audit row in `qbBulkActionRetentionLastChange`", async () => {
      const res = await request(app)
        .get("/api/platform-settings")
        .set("Cookie", adminCookie(adminUserId));
      expect(res.status).toBe(200);
      // The latest write was the clear-the-override change above.
      expect(res.body.qbBulkActionRetentionLastChange).toMatchObject({
        actorUserId: adminUserId,
        actorDisplayName: adminDisplayName,
        actorRole: "admin",
        prevValue: "14",
        newValue: null,
      });
    });

    it("PATCH from a non-admin caller is 403'd and writes nothing", async () => {
      const before = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      const res = await request(app)
        .patch("/api/platform-settings")
        .set("Cookie", vendorCookie(nonAdminUserId))
        .send({ qbBulkActionRetentionDays: 30 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("auth.admin_required");
      const after = await dbModule.db
        .select()
        .from(dbModule.platformSettingsAuditLogTable)
        .where(
          eq(
            dbModule.platformSettingsAuditLogTable.field,
            "qbBulkActionRetentionDays",
          ),
        );
      expect(after.length).toBe(before.length);
    });
  },
);
