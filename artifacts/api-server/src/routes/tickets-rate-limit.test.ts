import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// End-to-end coverage for the per-session rate limit added in Task #675.
// We mount the real tickets router with a stubbed db (so list/detail
// requests return cleanly without touching Postgres) and drive enough
// requests through GET /api/tickets and GET /api/tickets/:id to trip
// the limiter, then assert:
//   • the trip returns HTTP 429 with a `Retry-After` header and a
//     structured `code: "tickets.rate_limited"` body the web client
//     can branch on
//   • the budget is per-session (a different user is unaffected)
//   • the budget covers BOTH list and detail (a single client can't
//     dodge the limit by alternating endpoints)
//   • allowed responses keep working (the limiter only short-circuits
//     on trip — no off-by-one that blocks the boundary call)


function adminCookie(userId: number): string {
  return buildTestCookie({
    userId,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

// A db.select() chain that returns an empty array for every shape — both
// `await chain` and longer fluent chains. The list/detail handlers don't
// care about result content for the purposes of the rate limit; we only
// need 200s on allow and 429s on trip.
function makeChain() {
  const run = () => Promise.resolve([] as unknown[]);
  const chain: any = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: any, reject: any) => run().then(resolve, reject);
  chain.catch = (reject: any) => run().catch(reject);
  chain.finally = (cb: any) => run().finally(cb);
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => makeChain(),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    workTypesTable: tableTag("workTypes"),
    fieldEmployeesTable: tableTag("fieldEmployees"),
    partnersTable: tableTag("partners"),
    gpsLogsTable: tableTag("gpsLogs"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
    ticketUnlocksTable: tableTag("ticketUnlocks"),
    ticketLineItemsTable: tableTag("ticketLineItems"),
    taxRatesTable: tableTag("taxRates"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    ticketStatusHistoryTable: tableTag("ticketStatusHistory"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = () => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    and: passthrough,
    or: passthrough,
    eq: passthrough,
    ne: passthrough,
    isNull: passthrough,
    inArray: passthrough,
    sql: sqlTag,
    desc: passthrough,
    asc: passthrough,
    gte: passthrough,
    aliasedTable: (t: any) => t,
  };
});

let app: express.Express;
let TICKETS_RATE_LIMIT_CONFIG: { max: number; windowMs: number };

beforeEach(async () => {
  // Tighten the limit aggressively for the integration test so we can
  // trip it in a handful of requests instead of 30. This also proves
  // the env-driven config wires through correctly.
  process.env.TICKETS_RATE_LIMIT_MAX = "5";
  process.env.TICKETS_RATE_LIMIT_WINDOW_MS = "10000";
  vi.resetModules();
  const router = (await import("./tickets")).default;
  TICKETS_RATE_LIMIT_CONFIG = (await import("../lib/tickets-rate-limit"))
    .TICKETS_RATE_LIMIT_CONFIG;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TICKETS_RATE_LIMIT_MAX;
  delete process.env.TICKETS_RATE_LIMIT_WINDOW_MS;
});

describe("GET /api/tickets rate limit (Task #675)", () => {
  it("allows the configured budget then returns 429 with Retry-After", async () => {
    const cookie = adminCookie(101);
    expect(TICKETS_RATE_LIMIT_CONFIG.max).toBe(5);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      const ok = await request(app).get("/api/tickets").set("Cookie", cookie);
      expectStatus(ok, 200);
    }
    const blocked = await request(app)
      .get("/api/tickets")
      .set("Cookie", cookie);
    expect(blocked.status).toBe(429);
    // RFC 9110 §10.2.3 — Retry-After in seconds, must be a positive int.
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    // Structured body so the web client can swap to the reconnecting
    // pill instead of toasting a generic "Action failed".
    expect(blocked.body.code).toBe("tickets.rate_limited");
    expect(blocked.body.error).toBe("rate_limited");
    expect(typeof blocked.body.retryAfterSeconds).toBe("number");
    expect(blocked.body.limit).toBe(TICKETS_RATE_LIMIT_CONFIG.max);
  });

  it("scopes the budget per session — a second user is not affected", async () => {
    const cookieA = adminCookie(201);
    const cookieB = adminCookie(202);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      const ok = await request(app).get("/api/tickets").set("Cookie", cookieA);
      expectStatus(ok, 200);
    }
    const blocked = await request(app)
      .get("/api/tickets")
      .set("Cookie", cookieA);
    expect(blocked.status).toBe(429);

    // Different user keeps their own full budget.
    const otherUser = await request(app)
      .get("/api/tickets")
      .set("Cookie", cookieB);
    expectStatus(otherUser, 200);
  });

  it("counts list and detail requests against the same per-session budget", async () => {
    const cookie = adminCookie(301);
    // 3 list + 2 detail = 5 hits — the cap. Next request (either route)
    // should trip.
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get("/api/tickets").set("Cookie", cookie);
      expectStatus(ok, 200);
    }
    for (let i = 0; i < 2; i++) {
      const ok = await request(app)
        .get("/api/tickets/123")
        .set("Cookie", cookie);
      // Detail handler may 404/etc. on the empty-row stub, but we only
      // care that it isn't 429 yet.
      expect(ok.status).not.toBe(429);
    }
    const blockedDetail = await request(app)
      .get("/api/tickets/124")
      .set("Cookie", cookie);
    expect(blockedDetail.status).toBe(429);
    expect(blockedDetail.body.code).toBe("tickets.rate_limited");
  });

  it("happy-path traffic well under the cap is never throttled", async () => {
    const cookie = adminCookie(401);
    // Far below the cap — the normal poll + manual-refresh cadence
    // should never trigger a 429.
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max - 1; i++) {
      const ok = await request(app).get("/api/tickets").set("Cookie", cookie);
      expectStatus(ok, 200);
    }
  });
});
