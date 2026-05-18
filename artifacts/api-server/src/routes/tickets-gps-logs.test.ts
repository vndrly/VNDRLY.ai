import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { GetTicketGpsLogsResponse } from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";

// Regression coverage for the /api/tickets/:id/gps-logs 500 that fired when a
// ticket had any `live_ping` rows. The live-tracking writer in
// routes/locations.ts inserts gps_logs with eventType="live_ping", but the
// response zod schema only listed check_in / check_out / tracking, so
// GetTicketGpsLogsResponse.parse(...) threw inside the route handler. We now
// (a) verify the schema accepts live_ping at the contract level, and (b)
// mount the real route handler with a stubbed db that returns a live_ping row
// and assert it round-trips as 200 + JSON.

const ADMIN_USER_ID = 99;


const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

let gpsRows: any[] = [];

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

// Spread the real `@workspace/db` exports first so any new schema export
// added to `routes/tickets.ts` (or its transitive imports) is automatically
// present on the mocked module — then override only the runtime surface
// the test needs to control: `db` (so `select(...).from(...)` returns the
// `gpsRows` fixture) and `pool` (kept harmless). The previous hand-rolled
// table-tag list silently broke this whole suite at module load any time
// a new table import landed in tickets.ts (e.g. `siteWorkAssignmentsTable`);
// the spread makes those additions a no-op for this test.
vi.mock("@workspace/db", async () => {
  // Pull from the `/schema` subpath rather than the package root: the root
  // entry eagerly constructs a `pg.Pool` + `drizzle(pool, { schema })`,
  // which trips drizzle's relational-config extractor inside the test
  // environment. The schema subpath re-exports every table tag and enum
  // constant without that side effect, so spreading it is safe at mock-
  // factory time.
  const schema =
    await vi.importActual<typeof import("@workspace/db/schema")>(
      "@workspace/db/schema",
    );
  const db: any = {
    select: () => makeChain(gpsRows),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  return {
    ...schema,
    db,
    pool: { query: async () => ({ rows: [] }) },
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = () => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    and: passthrough,
    eq: passthrough,
    isNull: passthrough,
    inArray: passthrough,
    sql: sqlTag,
    desc: passthrough,
    gte: passthrough,
    aliasedTable: (t: any) => t,
  };
});

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  gpsRows = [];
  const router = (await import("./tickets")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tickets/:id/gps-logs", () => {
  it("returns 200 and serializes a row with eventType='live_ping'", async () => {
    gpsRows = [
      {
        id: 1,
        ticketId: 42,
        latitude: 31.5,
        longitude: -97.1,
        eventType: "live_ping",
        recordedAt: new Date().toISOString(),
      },
    ];
    const res = await request(app)
      .get("/api/tickets/42/gps-logs")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].eventType).toBe("live_ping");
  });

  it("returns 200 with a mix of historical and live_ping event types", async () => {
    const now = new Date().toISOString();
    gpsRows = [
      {
        id: 1,
        ticketId: 42,
        latitude: 31.5,
        longitude: -97.1,
        eventType: "check_in",
        recordedAt: now,
      },
      {
        id: 2,
        ticketId: 42,
        latitude: 31.6,
        longitude: -97.2,
        eventType: "live_ping",
        recordedAt: now,
      },
      {
        id: 3,
        ticketId: 42,
        latitude: 31.7,
        longitude: -97.3,
        eventType: "tracking",
        recordedAt: now,
      },
    ];
    const res = await request(app)
      .get("/api/tickets/42/gps-logs")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(3);
  });
});

describe("GetTicketGpsLogsResponse contract", () => {
  it("accepts live_ping in the response schema", () => {
    const result = GetTicketGpsLogsResponse.safeParse([
      {
        id: 1,
        ticketId: 42,
        latitude: 31.5,
        longitude: -97.1,
        eventType: "live_ping",
        recordedAt: new Date().toISOString(),
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown event type so we catch future drift", () => {
    const result = GetTicketGpsLogsResponse.safeParse([
      {
        id: 1,
        ticketId: 42,
        latitude: 31.5,
        longitude: -97.1,
        eventType: "definitely_not_a_real_type",
        recordedAt: new Date().toISOString(),
      },
    ]);
    expect(result.success).toBe(false);
  });
});
