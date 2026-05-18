// Integration test for the server-side exact-duplicate guard on
// PATCH /api/vendors/:id (vendor rename). The route normalizes the
// new name with the same `normalizeVendorName` helper that the POST
// guard and the duplicate-warning UI use (NFKD fold, lowercase,
// punctuation stripped, generic corporate suffixes dropped) and
// rejects with 409 if any *other* vendor canonicalizes to the same
// form. Renaming a vendor to a value that only collides with itself
// is allowed (no-op rename / casing change). Mirrors
// vendors-create-duplicate.test.ts so the rename path is covered by
// the same contract.
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

function adminCookie(): string {
  return buildTestCookie({
    userId: 1,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

const MARKER = `dup-rename-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "PATCH /api/vendors/:id duplicate-name guard",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    const createdIds: number[] = [];

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./vendors")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);
    });

    afterAll(async () => {
      for (const id of createdIds) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, id));
      }
    });

    async function seed(name: string): Promise<number> {
      const [v] = await db
        .insert(s.vendorsTable)
        .values({
          name,
          contactName: "Seed",
          contactEmail: `${MARKER}-${createdIds.length}@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      createdIds.push(v.id);
      return v.id;
    }

    function patchVendor(id: number, body: Record<string, unknown>) {
      return request(app)
        .patch(`/api/vendors/${id}`)
        .set("Cookie", adminCookie())
        .send(body);
    }

    it("blocks renaming a vendor to an exact case-insensitive duplicate", async () => {
      const conflictName = `${MARKER}-Acme`;
      const conflictId = await seed(conflictName);
      const renameId = await seed(`${MARKER}-Other`);

      const res = await patchVendor(renameId, { name: conflictName.toUpperCase() });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.existingVendor?.id).toBe(conflictId);
      expect(res.body.existingVendor?.name).toBe(conflictName);
      expect(res.body.details?.name).toBe(conflictName);
    });

    it("blocks renaming when only a corporate suffix differs", async () => {
      // The normalize helper strips "Inc", "LLC", etc., so these two
      // names canonicalize to the same string. The DB unique index on
      // lower(btrim(name)) does NOT catch this — the route's pre-check
      // is what's under test here.
      const conflictName = `${MARKER}-Beta Industries`;
      const conflictId = await seed(conflictName);
      const renameId = await seed(`${MARKER}-Beta Holdings`);

      const res = await patchVendor(renameId, {
        name: `${MARKER}-Beta Industries, Inc.`,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.existingVendor?.id).toBe(conflictId);
      expect(res.body.details?.name).toBe(conflictName);
    });

    it("allows renaming a vendor to a clearly distinct name", async () => {
      await seed(`${MARKER}-Gamma`);
      const renameId = await seed(`${MARKER}-Original`);

      const res = await patchVendor(renameId, {
        name: `${MARKER}-Delta Wireline`,
      });
      expectStatus(res, 200);
      expect(res.body.id).toBe(renameId);
      expect(res.body.name).toBe(`${MARKER}-Delta Wireline`);
    });

    it("allows a no-op rename that only collides with the same vendor", async () => {
      // The guard must exclude the row being updated when scanning for
      // collisions — otherwise an admin couldn't fix casing or
      // punctuation on an existing vendor without first picking a
      // throwaway name.
      const id = await seed(`${MARKER}-Epsilon`);

      const res = await patchVendor(id, { name: `${MARKER}-EPSILON` });
      expectStatus(res, 200);
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe(`${MARKER}-EPSILON`);
    });

    it("allows PATCH that does not change the name field", async () => {
      // When `name` is omitted from the body the guard must skip
      // entirely so unrelated edits (contact info, branding, etc.)
      // don't trigger a self-collision check.
      const id = await seed(`${MARKER}-Zeta`);

      const res = await patchVendor(id, { contactName: "Updated Person" });
      expectStatus(res, 200);
      expect(res.body.id).toBe(id);
      expect(res.body.contactName).toBe("Updated Person");
    });
  },
);
