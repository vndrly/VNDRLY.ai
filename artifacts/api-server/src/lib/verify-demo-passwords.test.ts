import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import pg from "pg";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { assertIsolatedTestDatabaseEnvironment } from "../../../../scripts/e2e-isolation.mjs";

// ---------------------------------------------------------------------------
// Regression coverage for the dev-only startup self-check added in Task #739
// (`verifyDemoPasswords`): if a demo user's stored bcrypt hash no longer
// verifies against the canonical demo password (e.g. a SQL import from
// another environment overwrote it), boot must log a one-line warning naming
// the drifted username so an operator knows to call `POST /api/auth/seed`
// to recover. Without an automated test, a future refactor could quietly
// drop the warning and the only signal would be silent 401s on the demo
// login screen.
//
// The mismatch is simulated at the comparison boundary for one stored hash.
// All actual database passwords remain canonical, and the self-check must
// remain read-only even when it detects the simulated drift.
//
// Requires the isolated wrapper's marker plus identical sanitized `_test`
// DATABASE_URL/TEST_DATABASE_URL values. The guard returns before opening a
// client in every other environment. Mirrors the gating used by
// `auth-seed-recovery.test.ts`.
// ---------------------------------------------------------------------------

const haveRealDb = await checkRealDb();

async function checkRealDb(): Promise<boolean> {
  let databaseUrl: string;
  try {
    databaseUrl = assertIsolatedTestDatabaseEnvironment(
      process.env,
    ).databaseUrl;
  } catch (error) {
    if (process.env.VNDRLY_TEST_DB_MODE === "fresh-local") throw error;
    return false;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    if (process.env.VNDRLY_TEST_DB_MODE === "fresh-local") throw error;
    return false;
  }
}

describe.runIf(haveRealDb)("verifyDemoPasswords startup self-check", () => {
  let app: express.Express;
  let db: typeof import("@workspace/db").db;
  let usersTable: typeof import("@workspace/db").usersTable;
  let verifyDemoPasswords: typeof import("./verify-demo-passwords").verifyDemoPasswords;
  let logger: typeof import("./logger").logger;
  // The dev-only `/auth/seed` endpoint requires NODE_ENV === "development"
  // at module-load time. Stash the original so other test files see the
  // same env they would have without our override.
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = "development";
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    usersTable = dbModule.usersTable;
    verifyDemoPasswords = (await import("./verify-demo-passwords"))
      .verifyDemoPasswords;
    logger = (await import("./logger")).logger;
    const authRouter = (await import("../routes/auth")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use("/api", authRouter);

    // Make sure the demo users exist before the read-only self-check.
    const seedRes = await request(app).post("/api/auth/seed");
    expect(seedRes.status).toBe(200);
  });

  afterAll(async () => {
    // Be a good neighbour: re-run seed so any subsequent tests find the
    // canonical demo passwords intact, regardless of whether assertions
    // above failed midway through.
    try {
      await request(app).post("/api/auth/seed");
    } catch {
      /* best-effort */
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("does not warn when every demo hash verifies", async () => {
    // Fresh seed in beforeAll left every demo hash at canonical, so the
    // self-check should be silent. Any warn here means the diff detector
    // has a false-positive — which would train operators to ignore the
    // warning and defeat the whole point of the boot signal.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await verifyDemoPasswords();
      const driftWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[1] ?? "").includes("verifyDemoPasswords"),
      );
      expect(driftWarnings).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns and names the drifted username when a demo hash is stale", async () => {
    const [intact] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower('shell')`);
    const compare = bcrypt.compareSync;
    const compareSpy = vi
      .spyOn(bcrypt, "compareSync")
      .mockImplementation((password, hash) =>
        hash === intact.passwordHash ? false : compare(password, hash),
      );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await verifyDemoPasswords();

      // Find the drift warning (a single call with a `drifted` payload and
      // a message mentioning the self-check name). Filter rather than
      // assert call count so unrelated warns from other modules don't make
      // the test brittle.
      const driftCalls = warnSpy.mock.calls.filter((call) => {
        const message = call[1];
        return (
          typeof message === "string" && message.includes("verifyDemoPasswords")
        );
      });
      expect(driftCalls).toHaveLength(1);

      const [payload, message] = driftCalls[0]!;
      expect(message).toMatch(/POST \/api\/auth\/seed/);
      expect(payload).toMatchObject({ drifted: expect.any(Array) });
      const drifted = (payload as { drifted: string[] }).drifted;
      expect(drifted).toContain("shell");
    } finally {
      compareSpy.mockRestore();
      warnSpy.mockRestore();
    }

    const [after] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower('shell')`);
    expect(after.passwordHash).toBe(intact.passwordHash);
  });
});
