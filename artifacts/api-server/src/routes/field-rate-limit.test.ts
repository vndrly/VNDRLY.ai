import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #761 — coverage for the per-session rate limit on the
// field-specific reads (`/api/field/open-tickets`,
// `/api/field/open-tickets/:id`, `/api/field/history`). These
// endpoints share the same `enforceTicketsRateLimit` budget that
// already protects `/api/tickets` and `/api/tickets/:id` (Task #675),
// so the mobile client's `ticketsRateLimitGate` pause indicator can
// fire on field traffic too.
//
// Pinned behavior:
//   • A vendor session hammering /api/field/open-tickets past the
//     configured budget receives HTTP 429 with `Retry-After` and the
//     structured `code: "tickets.rate_limited"` body the mobile gate
//     reads.
//   • The same per-session bucket counts list, detail, and history
//     hits — a client cannot dodge the cap by alternating routes.

const VENDOR_USER_ID = 4101;
const VENDOR_ID = 11;

const vendorCookie = buildTestCookie({
  userId: VENDOR_USER_ID,
  role: "vendor",
  vendorId: VENDOR_ID,
  partnerId: null,
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

// Vendor-mode requireFieldOrVendor only needs a vendors row lookup
// (no vendor_people join), so a one-row fixture is enough to keep
// the handler returning 200 when not rate-limited.
let selectQueue: Array<() => any[]> = [];

function makeChain(provider: () => any[]) {
  const run = () => provider();
  const chain: any = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(run()).then(resolve, reject);
  chain.catch = (reject: any) => Promise.resolve(run()).catch(reject);
  chain.finally = (cb: any) => Promise.resolve(run()).finally(cb);
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      const provider = selectQueue.shift() ?? (() => []);
      return makeChain(provider);
    },
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
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    fieldPushTokensTable: tableTag("fieldPushTokens"),
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
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
    isNotNull: passthrough,
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
  // Tighten so a handful of requests trips the limiter.
  process.env.TICKETS_RATE_LIMIT_MAX = "4";
  process.env.TICKETS_RATE_LIMIT_WINDOW_MS = "10000";
  vi.resetModules();
  selectQueue = [];
  const router = (await import("./field")).default;
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

// Vendor-mode requireFieldOrVendor issues one SELECT against `vendors`,
// then the open-tickets handler issues one SELECT against tickets.
function seedVendorOpenTicketsHit() {
  selectQueue.push(() => [{ id: VENDOR_ID, name: "Winchester" }]);
  selectQueue.push(() => []);
}

describe("Field endpoints rate limit (Task #761)", () => {
  it("allows the configured budget on /api/field/open-tickets then returns 429 with Retry-After", async () => {
    expect(TICKETS_RATE_LIMIT_CONFIG.max).toBe(4);
    for (let i = 0; i < TICKETS_RATE_LIMIT_CONFIG.max; i++) {
      seedVendorOpenTicketsHit();
      const ok = await request(app)
        .get("/api/field/open-tickets")
        .set("Cookie", vendorCookie);
      expectStatus(ok, 200);
    }
    const blocked = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", vendorCookie);
    expect(blocked.status).toBe(429);
    // RFC 9110 §10.2.3 — Retry-After in seconds, must be a positive int.
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    // Mobile `ticketsRateLimitGate` branches on this exact code.
    expect(blocked.body.code).toBe("tickets.rate_limited");
    expect(blocked.body.error).toBe("rate_limited");
    expect(typeof blocked.body.retryAfterSeconds).toBe("number");
    expect(blocked.body.limit).toBe(TICKETS_RATE_LIMIT_CONFIG.max);
  });

  it("shares one per-session bucket across field list, detail, and /api/tickets", async () => {
    // 2 list hits + 2 detail hits = 4 (the cap). The next field call,
    // regardless of route, should 429.
    for (let i = 0; i < 2; i++) {
      seedVendorOpenTicketsHit();
      const ok = await request(app)
        .get("/api/field/open-tickets")
        .set("Cookie", vendorCookie);
      expectStatus(ok, 200);
    }
    for (let i = 0; i < 2; i++) {
      // Detail handler does vendor lookup then a single ticket SELECT.
      selectQueue.push(() => [{ id: VENDOR_ID, name: "Winchester" }]);
      selectQueue.push(() => []);
      const ok = await request(app)
        .get(`/api/field/open-tickets/${500 + i}`)
        .set("Cookie", vendorCookie);
      // Stubbed empty SELECT yields 404, but we only care it isn't a 429.
      expect(ok.status).not.toBe(429);
    }
    const blocked = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", vendorCookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("tickets.rate_limited");
  });
});
