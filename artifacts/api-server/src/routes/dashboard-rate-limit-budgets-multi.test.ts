import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

// End-to-end coverage for the multi-endpoint admin readout added in
// Task #697 (`GET /api/admin/rate-limit-budgets`). This is the
// generalised replacement for the tickets-only readout from Task
// #688: it lists every per-role rate-limited endpoint family in the
// API (tickets, dashboard, live-locations, visits, notifications,
// comments, participants, hotlist) with
// their resolved per-role budgets, so an operator can confirm that
// any `<PREFIX>_RATE_LIMIT_MAX_<ROLE>` env override took effect
// after a restart, regardless of which endpoint they tuned.
//
// We assert:
//   • non-admin and unauthenticated requests are 403'd (no config
//     leak to vendor/partner/etc.) — the route uses the shared
//     `requireAdmin` middleware, which collapses both failure modes
//     onto the same 403 / `auth.admin_required` shape used by the
//     other admin-only routes in the API
//   • the response carries a per-endpoint entry for every registered
//     endpoint, each with its own default + per-role rows + env-var
//     hint pointing at its own prefix
//   • per-resource env-var lookups stay isolated: setting
//     `LIVE_LOCATIONS_RATE_LIMIT_MAX_VENDOR=200` flips the vendor row
//     on live-locations only, not on tickets / dashboard / visits /
//     notifications / comments / participants / hotlist (this is the
//     property the factory exists to enforce — operators must be able
//     to tune one endpoint without affecting another)

// Matches the literal `process.env.SESSION_SECRET` pinned by `test/setup.ts`
// — see the `DEFAULT_TEST_SESSION_SECRET` doc comment in
// `test-utils/session.ts` for why we rely on the literal rather than reading
// the env at runtime.
const SESSION_SECRET = "test-secret";
const COOKIE_NAME = "vndrly_session";

function signSession(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("hex");
  return `${body}.${sig}`;
}

function cookieFor(role: string, userId = 1): string {
  return `${COOKIE_NAME}=${signSession({
    userId,
    role,
    vendorId: null,
    partnerId: null,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })}`;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy({ __name: name }, { get: (_t, k: string) => ({ __table: name, __col: k }) });
  return {
    db: {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => Promise.resolve([]),
          }),
          where: () => Promise.resolve([]),
        }),
      }),
    },
    pool: { query: async () => ({ rows: [] }) },
    partnersTable: tableTag("partners"),
    vendorsTable: tableTag("vendors"),
    siteLocationsTable: tableTag("siteLocations"),
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    hotlistBidsTable: tableTag("hotlistBids"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = () => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    sql: sqlTag,
    eq: passthrough,
    desc: passthrough,
    and: passthrough,
  };
});

const PREFIXES = [
  "TICKETS",
  "DASHBOARD",
  "LIVE_LOCATIONS",
  "VISITS",
  "NOTIFICATIONS",
  "COMMENTS",
  "PARTICIPANTS",
  "HOTLIST",
];
const ROLES_UPPER = ["ADMIN", "PARTNER", "VENDOR", "FIELD_EMPLOYEE", "GUEST"];

let app: express.Express;

beforeEach(async () => {
  // Pin a known global default for every prefix so per-role
  // assertions are stable regardless of what each limiter's built-in
  // default happens to be.
  for (const p of PREFIXES) {
    process.env[`${p}_RATE_LIMIT_MAX`] = "30";
    process.env[`${p}_RATE_LIMIT_WINDOW_MS`] = "10000";
  }
  vi.resetModules();
  const router = (await import("./dashboard")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
  for (const p of PREFIXES) {
    delete process.env[`${p}_RATE_LIMIT_MAX`];
    delete process.env[`${p}_RATE_LIMIT_WINDOW_MS`];
    for (const role of ROLES_UPPER) {
      delete process.env[`${p}_RATE_LIMIT_MAX_${role}`];
      delete process.env[`${p}_RATE_LIMIT_WINDOW_MS_${role}`];
    }
  }
});

describe("GET /api/admin/rate-limit-budgets (Task #697)", () => {
  it("returns 403 with the canonical admin-required shape for unauth and non-admin callers", async () => {
    const unauth = await request(app).get("/api/admin/rate-limit-budgets");
    expect(unauth.status).toBe(403);
    expect(unauth.body.code).toBe("auth.admin_required");

    for (const role of ["partner", "vendor", "field_employee"]) {
      const r = await request(app)
        .get("/api/admin/rate-limit-budgets")
        .set("Cookie", cookieFor(role));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("auth.admin_required");
    }
  });

  it("lists every registered endpoint with its default + per-role rows + env-var hint", async () => {
    const r = await request(app)
      .get("/api/admin/rate-limit-budgets")
      .set("Cookie", cookieFor("admin"));
    expectStatus(r, 200);
    expect(Array.isArray(r.body.endpoints)).toBe(true);

    const keys = r.body.endpoints.map((e: { key: string }) => e.key);
    // Every limiter the factory backs today must show up.
    expect(keys).toEqual(
      expect.arrayContaining([
        "tickets",
        "dashboard",
        "live_locations",
        "visits",
        "notifications",
        "comments",
        "participants",
        "hotlist",
      ]),
    );

    // Task #700 follow-up #776: the readout must also tell operators
    // which BucketStore backend the limiters resolved to. Without
    // RATE_LIMIT_REDIS_URL / REDIS_URL set in the test env this is
    // the in-process MemoryBucketStore — and the prefix is null
    // because there's no shared keyspace to scope.
    expect(r.body.store).toEqual({ kind: "memory", prefix: null });

    for (const ep of r.body.endpoints) {
      expect(typeof ep.label).toBe("string");
      expect(typeof ep.description).toBe("string");
      expect(Array.isArray(ep.routes)).toBe(true);
      expect(ep.default).toEqual({ max: 30, windowMs: 10000 });
      // Order matches KNOWN_ROLES — admin first, guest last.
      expect(ep.roles.map((row: { role: string }) => row.role)).toEqual([
        "admin",
        "partner",
        "vendor",
        "field_employee",
        "guest",
      ]);
      for (const row of ep.roles) {
        expect(row.max).toBe(30);
        expect(row.windowMs).toBe(10000);
        expect(row.overridden).toBe(false);
      }
      // Hint must reference this endpoint's own env-var prefix so the
      // UI doesn't render the wrong knob name.
      expect(ep.envVarHint.max).toMatch(
        new RegExp(`^${ep.key.toUpperCase()}_RATE_LIMIT_MAX_<ROLE>$`),
      );
      expect(ep.envVarHint.windowMs).toMatch(
        new RegExp(`^${ep.key.toUpperCase()}_RATE_LIMIT_WINDOW_MS_<ROLE>$`),
      );
    }
  });

  it("isolates per-resource env-var lookups across endpoints", async () => {
    // Tuning live-locations must NOT bleed into the other endpoints'
    // budgets — that's the whole point of factoring each limiter
    // behind its own resource prefix.
    process.env.LIVE_LOCATIONS_RATE_LIMIT_MAX_VENDOR = "200";
    process.env.LIVE_LOCATIONS_RATE_LIMIT_WINDOW_MS_VENDOR = "5000";

    const r = await request(app)
      .get("/api/admin/rate-limit-budgets")
      .set("Cookie", cookieFor("admin"));
    expectStatus(r, 200);

    for (const ep of r.body.endpoints) {
      const byRole: Record<string, { max: number; windowMs: number; overridden: boolean }> =
        Object.fromEntries(
          ep.roles.map((row: { role: string; max: number; windowMs: number; overridden: boolean }) => [
            row.role,
            { max: row.max, windowMs: row.windowMs, overridden: row.overridden },
          ]),
        );
      if (ep.key === "live_locations") {
        expect(byRole.vendor).toEqual({ max: 200, windowMs: 5000, overridden: true });
      } else {
        expect(byRole.vendor).toEqual({ max: 30, windowMs: 10000, overridden: false });
      }
      // Untouched roles never flip on any endpoint.
      expect(byRole.admin.overridden).toBe(false);
      expect(byRole.partner.overridden).toBe(false);
    }
  });

  it("reports recent 429 trip counts per role from the in-process ring buffer (Task #763)", async () => {
    // Pull the tickets limiter directly so we can synthesise a few
    // 429 trips into its in-process ring buffer without standing up
    // an end-to-end abuse loop. The registry resolver reads from
    // the same buffer that `enforceTicketsRateLimit` writes to, so
    // the route MUST expose the counts on the per-role rows.
    const ticketsMod = await import("../lib/tickets-rate-limit");
    await ticketsMod.__resetTicketsRateLimitStateForTests();
    process.env.TICKETS_RATE_LIMIT_MAX = "1";
    process.env.TICKETS_RATE_LIMIT_WINDOW_MS = "60000";

    // Enforce against a stub req/res to drive trips for two distinct
    // roles + one unauthenticated caller. Each role hits the cap on
    // its first request (max=1) and trips on the second.
    const stubRes = () => {
      const headers: Record<string, string> = {};
      return {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        status: () => ({ json: () => undefined }),
      } as unknown as import("express").Response;
    };
    const stubReq = (ip: string) =>
      ({
        path: "/api/tickets",
        method: "GET",
        ip,
        headers: {},
        socket: { remoteAddress: ip },
      }) as unknown as import("express").Request;

    const session = (userId: number, role: string) => ({ userId, role });
    // vendor: 4 trips total — userId 10 calls 4 times (trips on
    // calls 2/3/4 → 3 trips), userId 11 calls 2 times (trip on
    // call 2 → 1 trip).
    for (let i = 0; i < 4; i++) {
      await ticketsMod.enforceTicketsRateLimit(
        stubReq("1.1.1.10"),
        stubRes(),
        session(10, "vendor"),
      );
    }
    for (let i = 0; i < 2; i++) {
      await ticketsMod.enforceTicketsRateLimit(
        stubReq("1.1.1.11"),
        stubRes(),
        session(11, "vendor"),
      );
    }
    // partner: 2 trips from 1 session (3 calls, max 1 → trips 2, 3)
    for (let i = 0; i < 3; i++) {
      await ticketsMod.enforceTicketsRateLimit(
        stubReq("2.2.2.2"),
        stubRes(),
        session(20, "partner"),
      );
    }
    // Unauthenticated: 1 trip
    await ticketsMod.enforceTicketsRateLimit(
      stubReq("3.3.3.3"),
      stubRes(),
      null,
    );
    await ticketsMod.enforceTicketsRateLimit(
      stubReq("3.3.3.3"),
      stubRes(),
      null,
    );

    const r = await request(app)
      .get("/api/admin/rate-limit-budgets")
      .set("Cookie", cookieFor("admin"));
    expectStatus(r, 200);

    const tickets = r.body.endpoints.find(
      (e: { key: string }) => e.key === "tickets",
    );
    expect(tickets.recentTripsWindowMs).toBe(15 * 60 * 1000);
    // vendor tripped 3 times above the cap (4 calls, max 1 → trips 2, 3, 4 → 3 trips)
    const vendorRow = tickets.roles.find(
      (row: { role: string }) => row.role === "vendor",
    );
    const partnerRow = tickets.roles.find(
      (row: { role: string }) => row.role === "partner",
    );
    const adminRow = tickets.roles.find(
      (row: { role: string }) => row.role === "admin",
    );
    // u:10 trips on calls 2/3/4 (3 trips) + u:11 trips on call 2
    // (1 trip) → 4 vendor trips total.
    expect(vendorRow.recentTrips).toBe(4);
    // partner tripped 2 times (3 calls, max 1 → trips 2, 3)
    expect(partnerRow.recentTrips).toBe(2);
    // admin never tripped
    expect(adminRow.recentTrips).toBe(0);
    // 1 trip from the unauthenticated caller (2 calls, max 1 → trip 2)
    expect(tickets.recentTripsUnknown).toBe(1);
    expect(tickets.recentTripsTotal).toBe(4 + 2 + 1);

    // Other endpoints share the same shape but report zero trips
    // since we only exercised tickets.
    for (const ep of r.body.endpoints) {
      if (ep.key === "tickets") continue;
      expect(ep.recentTripsTotal).toBe(0);
      expect(ep.recentTripsUnknown).toBe(0);
      for (const row of ep.roles) {
        expect(row.recentTrips).toBe(0);
      }
    }

    await ticketsMod.__resetTicketsRateLimitStateForTests();
  });

  it("surfaces the Redis backing store + key prefix when the limiter resolved to Redis (Task #776)", async () => {
    // The default-store resolver memoises after first use, so a
    // straight `RATE_LIMIT_REDIS_URL=…` env flip from the memory
    // case in the test above wouldn't re-resolve. Mock the
    // bucket-store module before re-importing the dashboard router
    // so the admin readout sees the redis-resolved snapshot
    // without us actually spinning up a Redis client (or pulling
    // ioredis into the test bundle).
    vi.resetModules();
    vi.doMock("../lib/bucket-store", async () => {
      const actual = await vi.importActual<
        typeof import("../lib/bucket-store")
      >("../lib/bucket-store");
      return {
        ...actual,
        getResolvedDefaultStoreInfo: () => ({
          kind: "redis" as const,
          prefix: "vndrly:rl:",
        }),
      };
    });
    const router = (await import("./dashboard")).default;
    const localApp = express();
    localApp.use(cookieParser());
    localApp.use(express.json());
    localApp.use("/api", router);
    attachTestErrorMiddleware(localApp);

    const r = await request(localApp)
      .get("/api/admin/rate-limit-budgets")
      .set("Cookie", cookieFor("admin"));
    expectStatus(r, 200);
    expect(r.body.store).toEqual({ kind: "redis", prefix: "vndrly:rl:" });
    // Endpoints still render so the readout doesn't degrade when
    // the store resolves to redis.
    expect(Array.isArray(r.body.endpoints)).toBe(true);
    expect(r.body.endpoints.length).toBeGreaterThan(0);

    vi.doUnmock("../lib/bucket-store");
  });

  it("reflects a per-prefix global default change in default row + inheriting roles", async () => {
    process.env.TICKETS_RATE_LIMIT_MAX = "200";
    process.env.TICKETS_RATE_LIMIT_WINDOW_MS = "60000";

    const r = await request(app)
      .get("/api/admin/rate-limit-budgets")
      .set("Cookie", cookieFor("admin"));
    expectStatus(r, 200);

    const tickets = r.body.endpoints.find((e: { key: string }) => e.key === "tickets");
    expect(tickets.default).toEqual({ max: 200, windowMs: 60000 });
    for (const row of tickets.roles) {
      expect(row.max).toBe(200);
      expect(row.windowMs).toBe(60000);
      expect(row.overridden).toBe(false);
    }
    // Other endpoints stay on their own pinned default (30 / 10000).
    for (const ep of r.body.endpoints) {
      if (ep.key === "tickets") continue;
      expect(ep.default).toEqual({ max: 30, windowMs: 10000 });
    }
  });
});
