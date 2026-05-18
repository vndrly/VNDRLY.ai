// Integration test for the server-side exact-duplicate guard on
// PATCH /api/partners/:id (partner rename). The route now detects an
// exact case/whitespace collision against the
// `partners_canonical_name_unique` index (lower(btrim(name))) and
// returns a 409 with `partner.duplicate_name` + the conflicting
// partner id, instead of bubbling the Postgres unique violation up
// as a generic 500. Mirrors vendors-update-duplicate.test.ts for
// the partner side. (Task #855)
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

const MARKER = `dup-partner-rename-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

describe.runIf(haveRealDb)(
  "PATCH /api/partners/:id duplicate-name guard",
  () => {
    let app: express.Express;
    let db: typeof import("@workspace/db").db;
    let s: typeof import("@workspace/db");
    const createdIds: number[] = [];

    beforeAll(async () => {
      s = await import("@workspace/db");
      db = s.db;
      const router = (await import("./partners")).default;
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use("/api", router);
      attachTestErrorMiddleware(app);
    });

    afterAll(async () => {
      for (const id of createdIds) {
        await db.delete(s.partnersTable).where(eq(s.partnersTable.id, id));
      }
    });

    async function seed(name: string): Promise<number> {
      const [p] = await db
        .insert(s.partnersTable)
        .values({
          name,
          contactName: "Seed",
          contactEmail: `${MARKER}-${createdIds.length}@example.com`,
        })
        .returning({ id: s.partnersTable.id });
      createdIds.push(p.id);
      return p.id;
    }

    function patchPartner(id: number, body: Record<string, unknown>) {
      return request(app)
        .patch(`/api/partners/${id}`)
        .set("Cookie", adminCookie())
        .send(body);
    }

    it("blocks renaming a partner to an exact case-insensitive duplicate", async () => {
      const conflictName = `${MARKER}-Acme`;
      const conflictId = await seed(conflictName);
      const renameId = await seed(`${MARKER}-Other`);

      const res = await patchPartner(renameId, {
        name: conflictName.toUpperCase(),
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("partner.duplicate_name");
      expect(res.body.existingPartner?.id).toBe(conflictId);
      expect(res.body.existingPartner?.name).toBe(conflictName);
      // Task #603 / #855: structured `details.name` is forwarded by the
      // web's translateApiError helper to i18next as `{{name}}` so the
      // EN/ES copy can render the conflicting partner name.
      expect(res.body.details?.name).toBe(conflictName);
    });

    it("blocks renaming a partner when only whitespace differs", async () => {
      // The DB unique index is on `lower(btrim(name))`, so the route
      // must catch surrounding whitespace too.
      const conflictName = `${MARKER}-Whitespace`;
      const conflictId = await seed(conflictName);
      const renameId = await seed(`${MARKER}-Renamed`);

      const res = await patchPartner(renameId, {
        name: `   ${conflictName}   `,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("partner.duplicate_name");
      expect(res.body.existingPartner?.id).toBe(conflictId);
    });

    it("allows renaming a partner to a clearly distinct name", async () => {
      await seed(`${MARKER}-Gamma`);
      const renameId = await seed(`${MARKER}-Original`);

      const res = await patchPartner(renameId, {
        name: `${MARKER}-Delta Operating`,
      });
      expectStatus(res, 200);
      expect(res.body.id).toBe(renameId);
      expect(res.body.name).toBe(`${MARKER}-Delta Operating`);
    });

    it("allows a no-op rename that only collides with the same partner", async () => {
      // The guard must exclude the row being updated when scanning for
      // collisions — otherwise an admin couldn't fix casing on an
      // existing partner without first picking a throwaway name.
      const id = await seed(`${MARKER}-Epsilon`);

      const res = await patchPartner(id, { name: `${MARKER}-EPSILON` });
      expectStatus(res, 200);
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe(`${MARKER}-EPSILON`);
    });

    it("allows PATCH that does not change the name field", async () => {
      // When `name` is omitted from the body the guard must skip
      // entirely so unrelated edits (contact info, branding, etc.)
      // don't trigger a self-collision check.
      const id = await seed(`${MARKER}-Zeta`);

      const res = await patchPartner(id, { contactName: "Updated Person" });
      expectStatus(res, 200);
      expect(res.body.id).toBe(id);
      expect(res.body.contactName).toBe("Updated Person");
    });
  },
);
