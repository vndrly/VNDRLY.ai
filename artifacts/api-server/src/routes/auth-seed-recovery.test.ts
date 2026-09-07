import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import pg from "pg";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { assertIsolatedTestDatabaseEnvironment } from "../../../../scripts/e2e-isolation.mjs";

// ---------------------------------------------------------------------------
// Regression coverage for the demo-login recovery branch in
// `POST /api/auth/seed` (Task #739): when an existing demo user's stored
// password hash no longer verifies against the canonical demo password
// (e.g. a SQL import from another environment left a stale bcrypt hash
// behind), the seeder must re-hash it back to the canonical demo
// password and report the username in the response's `passwordReset`
// array. Without this branch, demo logins silently 401 and the only
// recovery is hand-editing bcrypt hashes.
//
// Recovery is exercised by simulating a failed comparison for one stored
// hash. Stored demo passwords remain canonical throughout the test, including
// when an assertion fails; the real seed route and persistence still run.
//
// Requires the isolated wrapper's marker plus identical sanitized `_test`
// DATABASE_URL/TEST_DATABASE_URL values. The guard returns before opening a
// client for every other environment, including a shared development URL.
// ---------------------------------------------------------------------------

async function withSimulatedPasswordDrift<T>(
  hash: string,
  action: () => Promise<T>,
): Promise<T> {
  const compare = bcrypt.compareSync;
  const spy = vi
    .spyOn(bcrypt, "compareSync")
    .mockImplementation((password, candidate) =>
      candidate === hash ? false : compare(password, candidate),
    );
  try {
    return await action();
  } finally {
    spy.mockRestore();
  }
}

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

describe.runIf(haveRealDb)("POST /api/auth/seed demo password recovery", () => {
  let app: express.Express;
  let db: typeof import("@workspace/db").db;
  let usersTable: typeof import("@workspace/db").usersTable;
  let partnersTable: typeof import("@workspace/db").partnersTable;
  let vendorsTable: typeof import("@workspace/db").vendorsTable;
  let userOrgMembershipsTable: typeof import("@workspace/db").userOrgMembershipsTable;
  let firstSeedStatus = 0;
  // Stash the original NODE_ENV so afterAll can restore it. The dev-only
  // /auth/seed endpoint requires NODE_ENV === "development" at
  // module-load time, but other test files may rely on the prior value
  // being preserved across the suite (e.g. production-only branches).
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // The dev-only `/auth/seed` endpoint is only registered when
    // NODE_ENV === "development" at module-load time, so set it before
    // importing the auth router.
    process.env.NODE_ENV = "development";
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    usersTable = dbModule.usersTable;
    partnersTable = dbModule.partnersTable;
    vendorsTable = dbModule.vendorsTable;
    userOrgMembershipsTable = dbModule.userOrgMembershipsTable;
    const authRouter = (await import("./auth")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use("/api", authRouter);
    attachTestErrorMiddleware(app);

    // Make sure the demo users exist before exercising recovery.
    const seedRes = await request(app).post("/api/auth/seed");
    firstSeedStatus = seedRes.status;
    expectStatus(seedRes, 200);
  });

  it("returns 200 on the clean isolated schema and creates required natural-key organizations", async () => {
    expect(firstSeedStatus).toBe(200);

    const partners = await db
      .select({ name: partnersTable.name })
      .from(partnersTable);
    const vendors = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable);
    expect(partners.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "ExxonMobil",
        "Chevron",
        "Shell USA",
        "Marathon Oil",
        "BP America (BPX Energy)",
        "Mach Natural Resources",
      ]),
    );
    expect(vendors.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Precision Drilling",
        "Baker Hughes",
        "Winchester",
      ]),
    );
  });

  it("is idempotent and does not duplicate users, memberships, or organizations", async () => {
    const before = {
      users: (await db.select({ id: usersTable.id }).from(usersTable)).length,
      memberships: (
        await db
          .select({ id: userOrgMembershipsTable.id })
          .from(userOrgMembershipsTable)
      ).length,
      partners: (await db.select({ id: partnersTable.id }).from(partnersTable))
        .length,
      vendors: (await db.select({ id: vendorsTable.id }).from(vendorsTable))
        .length,
    };

    const rerun = await request(app).post("/api/auth/seed");
    expectStatus(rerun, 200);
    expect(rerun.body.added).toEqual([]);

    const after = {
      users: (await db.select({ id: usersTable.id }).from(usersTable)).length,
      memberships: (
        await db
          .select({ id: userOrgMembershipsTable.id })
          .from(userOrgMembershipsTable)
      ).length,
      partners: (await db.select({ id: partnersTable.id }).from(partnersTable))
        .length,
      vendors: (await db.select({ id: vendorsTable.id }).from(vendorsTable))
        .length,
    };
    expect(after).toEqual(before);

    const bakerRows = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(
        sql`lower(btrim(${vendorsTable.name})) in ('baker hughes', 'baker hughes field svcs', 'baker hughes field services')`,
      );
    expect(bakerRows).toHaveLength(1);
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
    // Restore the prior NODE_ENV so test files loaded after this one
    // see the same environment they would have without our override.
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("recovers from a failed password comparison using the canonical password", async () => {
    // Sanity: admin currently logs in with the canonical password.
    const before = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "vndrly123" });
    expectStatus(before, 200);

    const [intact] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower('admin')`);
    expect(bcrypt.compareSync("vndrly123", intact.passwordHash)).toBe(true);

    const recovered = await withSimulatedPasswordDrift(
      intact.passwordHash,
      () => request(app).post("/api/auth/seed"),
    );
    expectStatus(recovered, 200);
    expect(Array.isArray(recovered.body.passwordReset)).toBe(true);
    expect(recovered.body.passwordReset).toContain("admin");

    // The stored hash should once again verify against `vndrly123`.
    const [row] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower('admin')`);
    expect(row).toBeDefined();
    expect(row.passwordHash).not.toBe(intact.passwordHash);
    expect(bcrypt.compareSync("vndrly123", row.passwordHash)).toBe(true);

    // And the canonical login path returns 200 again.
    const after = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "vndrly123" });
    expectStatus(after, 200);
    expect(after.body.username).toBe("admin");
  });

  it("omits unchanged demo users from passwordReset on a no-op seed", async () => {
    // After the previous test left the admin password back at canonical,
    // a fresh seed call should report no drift for admin (the recovery
    // branch is idempotent, not blanket-rewriting every demo).
    const noop = await request(app).post("/api/auth/seed");
    expectStatus(noop, 200);
    expect(Array.isArray(noop.body.passwordReset)).toBe(true);
    expect(noop.body.passwordReset).not.toContain("admin");
  });

  it("restores an email-identified canonical alias and preserves its session version and row fields", async () => {
    const username = "auth-seed-email-alias-regression";
    const canonicalHash = bcrypt.hashSync("vndrly123", 10);
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower(${username})`);

    let userId: number;
    if (existing) {
      userId = existing.id;
      await db
        .update(usersTable)
        .set({
          email: "ADMIN@VNDRLY.COM",
          passwordHash: canonicalHash,
          sessionVersion: 73,
          displayName: "Preserved Alias Display",
        })
        .where(sql`${usersTable.id} = ${userId}`);
    } else {
      const [created] = await db
        .insert(usersTable)
        .values({
          username,
          email: "ADMIN@VNDRLY.COM",
          passwordHash: canonicalHash,
          role: "admin",
          displayName: "Preserved Alias Display",
          sessionVersion: 73,
        })
        .returning({ id: usersTable.id });
      userId = created.id;
    }

    const recovered = await withSimulatedPasswordDrift(canonicalHash, () =>
      request(app).post("/api/auth/seed"),
    );
    expectStatus(recovered, 200);
    expect(recovered.body.passwordReset).toContain("admin");

    const [row] = await db
      .select({
        username: usersTable.username,
        email: usersTable.email,
        displayName: usersTable.displayName,
        passwordHash: usersTable.passwordHash,
        sessionVersion: usersTable.sessionVersion,
      })
      .from(usersTable)
      .where(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = 'admin@vndrly.com' AND ${usersTable.id} = ${userId}`,
      );
    expect(row).toBeDefined();
    expect(row.username).toBe(username);
    expect(row.email).toBe("ADMIN@VNDRLY.COM");
    expect(row.displayName).toBe("Preserved Alias Display");
    expect(row.sessionVersion).toBe(73);
    expect(bcrypt.compareSync("vndrly123", row.passwordHash)).toBe(true);
  });

  it("recovers a simulated Joe Boggs hash mismatch without replacing his row or memberships and is idempotent", async () => {
    const identity = "joe.boggs@winchester.com";
    const canonicalHash = bcrypt.hashSync("winchester2", 10);
    const [existingJoe] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        sql`lower(coalesce(${usersTable.email}, ${usersTable.username})) = ${identity}`,
      );

    let userId: number;
    if (existingJoe) {
      userId = existingJoe.id;
      await db
        .update(usersTable)
        .set({ passwordHash: canonicalHash, mustChangePassword: true })
        .where(sql`${usersTable.id} = ${userId}`);
    } else {
      const [created] = await db
        .insert(usersTable)
        .values({
          username: identity,
          email: null,
          passwordHash: canonicalHash,
          role: "field_employee",
          displayName: "Joe Boggs",
          preferredLanguage: "en",
          mustChangePassword: true,
          sessionVersion: 84,
        })
        .returning({ id: usersTable.id });
      userId = created.id;
    }

    const [winchester] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(sql`lower(btrim(${vendorsTable.name})) = 'winchester'`);
    if (!winchester)
      throw new Error("Expected the natural-key Winchester vendor");

    const [existingMembership] = await db
      .select({ id: userOrgMembershipsTable.id })
      .from(userOrgMembershipsTable)
      .where(
        sql`${userOrgMembershipsTable.userId} = ${userId} AND ${userOrgMembershipsTable.vendorId} = ${winchester.id}`,
      );
    if (!existingMembership) {
      await db.insert(userOrgMembershipsTable).values({
        userId,
        orgType: "vendor",
        partnerId: null,
        vendorId: winchester.id,
        role: "field_employee",
      });
    }

    const [userBefore] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
        displayName: usersTable.displayName,
        preferredLanguage: usersTable.preferredLanguage,
        activeMembershipId: usersTable.activeMembershipId,
        sessionVersion: usersTable.sessionVersion,
      })
      .from(usersTable)
      .where(sql`${usersTable.id} = ${userId}`);
    const membershipsBefore = (
      await db
        .select({
          id: userOrgMembershipsTable.id,
          userId: userOrgMembershipsTable.userId,
          orgType: userOrgMembershipsTable.orgType,
          partnerId: userOrgMembershipsTable.partnerId,
          vendorId: userOrgMembershipsTable.vendorId,
          role: userOrgMembershipsTable.role,
        })
        .from(userOrgMembershipsTable)
        .where(sql`${userOrgMembershipsTable.userId} = ${userId}`)
    ).sort((left, right) => left.id - right.id);

    const recovered = await withSimulatedPasswordDrift(canonicalHash, () =>
      request(app).post("/api/auth/seed"),
    );
    expectStatus(recovered, 200);
    expect(recovered.body.passwordReset).toContain(identity);

    const [userAfter] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
        displayName: usersTable.displayName,
        preferredLanguage: usersTable.preferredLanguage,
        activeMembershipId: usersTable.activeMembershipId,
        sessionVersion: usersTable.sessionVersion,
        passwordHash: usersTable.passwordHash,
        mustChangePassword: usersTable.mustChangePassword,
      })
      .from(usersTable)
      .where(sql`${usersTable.id} = ${userId}`);
    const {
      passwordHash: recoveredHash,
      mustChangePassword: recoveredMustChangePassword,
      ...preservedUserAfter
    } = userAfter;
    expect(preservedUserAfter).toEqual(userBefore);
    expect(recoveredMustChangePassword).toBe(false);
    expect(recoveredHash).not.toBe(canonicalHash);
    expect(bcrypt.compareSync("winchester2", recoveredHash)).toBe(true);

    const membershipsAfter = (
      await db
        .select({
          id: userOrgMembershipsTable.id,
          userId: userOrgMembershipsTable.userId,
          orgType: userOrgMembershipsTable.orgType,
          partnerId: userOrgMembershipsTable.partnerId,
          vendorId: userOrgMembershipsTable.vendorId,
          role: userOrgMembershipsTable.role,
        })
        .from(userOrgMembershipsTable)
        .where(sql`${userOrgMembershipsTable.userId} = ${userId}`)
    ).sort((left, right) => left.id - right.id);
    expect(membershipsAfter).toEqual(membershipsBefore);

    const rerun = await request(app).post("/api/auth/seed");
    expectStatus(rerun, 200);
    expect(rerun.body.passwordReset).not.toContain(identity);

    const [userAfterRerun] = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
        displayName: usersTable.displayName,
        preferredLanguage: usersTable.preferredLanguage,
        activeMembershipId: usersTable.activeMembershipId,
        sessionVersion: usersTable.sessionVersion,
        passwordHash: usersTable.passwordHash,
        mustChangePassword: usersTable.mustChangePassword,
      })
      .from(usersTable)
      .where(sql`${usersTable.id} = ${userId}`);
    expect(userAfterRerun).toEqual(userAfter);
  });
});
