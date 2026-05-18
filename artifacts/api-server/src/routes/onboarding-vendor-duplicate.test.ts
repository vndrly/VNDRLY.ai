// Task #458: integration test for the canonical-name duplicate guard
// on the *public* mobile/web vendor self-signup endpoint
// (POST /api/onboarding/vendor). The admin-only POST /vendors route
// already had this guard (see vendors-create-duplicate.test.ts); this
// test mirrors that contract so the unauthenticated signup flow can't
// sneak past it either. Both paths run the candidate name through
// `normalizeVendorName` (NFKD fold, lowercase, punctuation stripped,
// generic corporate suffixes dropped) and reject with 409 if any
// existing vendor collapses to the same canonical form.
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

const MARKER = `dup-onboard-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "POST /api/onboarding/vendor duplicate-name guard",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    const createdVendorIds: number[] = [];
    const createdUserEmails: string[] = [];

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./onboarding")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);
    });

    afterAll(async () => {
      // Clean up vendors and users created by the test (both the seeds
      // and any rows the public endpoint created on success).
      for (const id of createdVendorIds) {
        await db.delete(s.vendorsTable).where(eq(s.vendorsTable.id, id));
      }
      for (const email of createdUserEmails) {
        await db
          .delete(s.usersTable)
          .where(eq(s.usersTable.username, email.toLowerCase()));
      }
    });

    async function seedVendor(name: string): Promise<number> {
      const [v] = await db
        .insert(s.vendorsTable)
        .values({
          name,
          contactName: "Seed",
          contactEmail: `${MARKER}-seed-${createdVendorIds.length}@example.com`,
        })
        .returning({ id: s.vendorsTable.id });
      createdVendorIds.push(v.id);
      return v.id;
    }

    function postSignup(name: string) {
      const email = `${MARKER}-${Math.random()
        .toString(36)
        .slice(2, 8)}@example.com`;
      createdUserEmails.push(email);
      return request(app)
        .post("/api/onboarding/vendor")
        .send({
          name,
          contactName: "New Contact",
          contactEmail: email,
          // Schema requires a non-empty phone string.
          contactPhone: "555-555-0100",
          // CreateVendorOnboardingBody requires >=8 char password.
          password: "hunter2hunter2",
        });
    }

    it("blocks an exact case-insensitive duplicate with 409", async () => {
      const name = `${MARKER}-Acme`;
      await seedVendor(name);

      const res = await postSignup(name.toUpperCase());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.details?.name).toBe(name);
    });

    it("blocks a duplicate that differs only in a corporate suffix", async () => {
      // The normalize helper strips "Inc", "LLC", etc., so these two
      // names canonicalize to the same string. The DB unique index on
      // lower(btrim(name)) does NOT catch this — the route's pre-check
      // is what's under test here.
      const name = `${MARKER}-Beta Industries`;
      await seedVendor(name);

      const res = await postSignup(`${MARKER}-Beta Industries, Inc.`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("vendor.duplicate_name");
      expect(res.body.details?.name).toBe(name);
    });

    it("allows a clearly distinct name", async () => {
      await seedVendor(`${MARKER}-Gamma`);

      const res = await postSignup(`${MARKER}-Delta Wireline`);
      expectStatus(res, 201);
      expect(res.body.orgType).toBe("vendor");
      expect(typeof res.body.orgId).toBe("number");
      createdVendorIds.push(res.body.orgId);
    });
  },
);
