// Integration test for the server-side exact-duplicate guard on
// POST /api/vendors. The route normalizes the new name with the same
// `normalizeVendorName` helper the duplicate-warning UI uses (NFKD
// fold, lowercase, punctuation stripped, generic corporate suffixes
// dropped) and rejects with 409 if any existing vendor collapses to
// the same canonical form. This test mounts the real router against
// the real DB (when available) and verifies the contract.
//
// Skips with a no-op describe when no real DATABASE_URL is reachable
// so the unit suite keeps running in offline CI.
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

const MARKER = `dup-route-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "POST /api/vendors duplicate-name guard",
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

    function postVendor(name: string) {
      return request(app)
        .post("/api/vendors")
        .set("Cookie", adminCookie())
        .send({
          name,
          contactName: "New Contact",
          contactEmail: `${MARKER}-post-${Math.random()
            .toString(36)
            .slice(2, 8)}@example.com`,
        });
    }

    it("blocks an exact case-insensitive duplicate with 409", async () => {
      const name = `${MARKER}-Acme`;
      const existingId = await seed(name);

      const res = await postVendor(name.toUpperCase());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.existingVendor?.id).toBe(existingId);
      expect(res.body.existingVendor?.name).toBe(name);
      // Task #603: structured `details` payload is forwarded by the
      // web's translateApiError helper to i18next as interpolation
      // values so the EN/ES copy can render the conflicting name.
      expect(res.body.details?.name).toBe(name);
    });

    it("blocks a duplicate that differs only in a corporate suffix", async () => {
      // The normalize helper strips "Inc", "LLC", etc., so these two
      // names canonicalize to the same string. The DB unique index on
      // lower(btrim(name)) does NOT catch this — the route's pre-check
      // is what's under test here.
      const name = `${MARKER}-Beta Industries`;
      const existingId = await seed(name);

      const res = await postVendor(`${MARKER}-Beta Industries, Inc.`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.existingVendor?.id).toBe(existingId);
      expect(res.body.details?.name).toBe(name);
    });

    it("allows a clearly distinct name", async () => {
      await seed(`${MARKER}-Gamma`);

      const res = await postVendor(`${MARKER}-Delta Wireline`);
      expectStatus(res, 201);
      expect(res.body.id).toBeTypeOf("number");
      createdIds.push(res.body.id);
    });
  },
);
