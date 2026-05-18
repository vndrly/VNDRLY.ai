import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { ListTicketsResponse } from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Regression coverage for the dispatcher / admin ticket list at
// GET /api/tickets — the most-trafficked surface backed by the shared
// `ticketSelect` projection in artifacts/api-server/src/routes/tickets.ts.
//
// Tasks #537 and #569 added analogous tests for two portal endpoints
// that feed the same projection straight into `Schema.parse(...)`. The
// outage pattern those tests guard against is identical here: when a
// column is added to `ListTicketsResponse` but forgotten in
// `ticketSelect`, the row coming back from the DB is missing that
// column, `sendResponse(...)` invokes `ListTicketsResponse.parse(...)`,
// the schema rejects the row, the route throws, and the entire ticket
// list page 500s. Without this test the only thing that catches the
// drift is a slow browser e2e.
//
// Mirroring tickets-portal-open-tickets.test.ts, this test mounts the
// real router with a stubbed db that honors the SELECT projection so
// `ticketQuery()` only returns the keys the route actually asked for.
// A missing or renamed column in `ticketSelect` will surface here as a
// failing test in seconds.

const ADMIN_USER_ID = 99;

const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
  // decodeSession() rejects tokens without `exp`, so include a far-future
  // expiration to keep these tests stable.
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

// Fixture state — populated per test, consumed by the mocked db chain.
// For the admin role the GET /tickets handler only runs a single SELECT
// (ticketQuery); we don't need to script a multi-call sequence here.
let ticketRows: any[] = [];

// Honors the projection passed to db.select(...) — only returns the keys
// the route actually asked for. This is what lets the test catch the
// regression: if `ticketSelect` stops projecting a column the response
// schema requires, the mock will faithfully drop it from the row and
// ListTicketsResponse.parse(...) inside sendResponse() will throw.
function projectRows(projection: Record<string, any> | undefined, rows: any[]): any[] {
  if (!projection) return rows;
  const keys = Object.keys(projection);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = row[k];
    return out;
  });
}

// A thenable chain that supports both `await chain` and longer fluent
// chains (e.g. ticketQuery().where(...).orderBy(...)) without losing the
// projection-aware row filter.
function makeChain(projection: Record<string, any> | undefined, rowsProvider: () => any[]) {
  const run = () => projectRows(projection, rowsProvider());
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
    select: (projection?: Record<string, any>) =>
      makeChain(projection, () => ticketRows),
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
    eq: passthrough,
    ne: passthrough,
    or: passthrough,
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

beforeEach(async () => {
  vi.resetModules();
  ticketRows = [];
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

// A complete ticket row that satisfies every key in `ticketSelect` (and
// therefore every required field on ListTicketsResponseItem). Tests that
// want to prove a column is required can strip a single key from this
// object before seeding.
// Task #882: defaults come from `makeTicketRow` so a future column on
// `ticketSelect` / `GetTicketResponse` cannot drift past this test
// without a clear "missing X" error from the shared drift guard. The
// overrides here pin only the realistic-looking values the assertions
// below check (ids, status/lifecycle, names, schedule, intake) without
// duplicating the rest of the projection.
function fullTicketRow(overrides: Record<string, unknown> = {}) {
  return makeTicketRow({
    id: 101,
    siteLocationId: 1,
    vendorId: 3,
    fieldEmployeeId: 50,
    workTypeId: 5,
    status: "in_progress",
    description: "Swap rod pump",
    notes: "Bring extra packing",
    checkInTime: new Date("2025-01-02T15:00:00.000Z"),
    checkInLatitude: 31.5,
    checkInLongitude: -97.1,
    siteName: "Test Pad 12",
    vendorName: "Permian Pumpers",
    vendorLogoUrl: "https://cdn.example/vendor.png",
    workTypeName: "Pumping",
    fieldEmployeeName: "Jane Doe",
    partnerName: "ACME Energy",
    partnerLogoUrl: "https://cdn.example/partner.png",
    createdAt: new Date("2025-01-02T14:00:00.000Z"),
    updatedAt: new Date("2025-01-02T15:30:00.000Z"),
    createdById: 99,
    createdByName: "Dispatcher Dan",
    lifecycleState: "on_site",
    enRouteAt: new Date("2025-01-02T14:30:00.000Z"),
    arrivedAt: new Date("2025-01-02T14:55:00.000Z"),
    siteLatitude: 31.5,
    siteLongitude: -97.1,
    siteRadiusMeters: 150,
    afe: "AFE-001",
    scheduledStartAt: new Date("2025-01-02T14:00:00.000Z"),
    scheduledDurationMinutes: 120,
    intakeChannel: "office_on_behalf_of_partner",
    ...overrides,
  });
}

describe("GET /api/tickets", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("happy path: response body parses cleanly against ListTicketsResponse", async () => {
    ticketRows = [
      fullTicketRow(),
      fullTicketRow({
        id: 102,
        status: "initiated" as const,
        lifecycleState: "pending_arrival" as const,
        enRouteAt: null,
        arrivedAt: null,
        checkInTime: null,
        checkInLatitude: null,
        checkInLongitude: null,
        fieldEmployeeId: null,
        fieldEmployeeName: null,
        intakeChannel: "partner_self_service" as const,
      }),
    ];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    // `sendResponse(...)` already calls .parse(...) before responding, so
    // a 200 here means the schema accepted the payload — but we re-parse
    // on the response body to lock the contract end-to-end. If
    // `ticketSelect` ever drifts away from the schema again, this
    // assertion will fail with a clear ZodError.
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].id).toBe(101);
      expect(parsed.data[0].siteName).toBe("Test Pad 12");
      expect(parsed.data[0].vendorName).toBe("Permian Pumpers");
      expect(parsed.data[1].status).toBe("initiated");
      expect(parsed.data[1].lifecycleState).toBe("pending_arrival");
    }
  });

  it("happy path: tolerates an empty ticket list", async () => {
    ticketRows = [];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual([]);
    }
  });

  it("happy path: keeps working when nullable schema fields come back null", async () => {
    // Most join-derived columns (siteName, vendorName, partnerName,
    // workTypeName, fieldEmployeeName, partnerLogoUrl, vendorLogoUrl,
    // afe, etc.) are nullable in the response schema — make sure
    // ticketSelect projects them in the all-null case too. This would
    // catch a future schema change that adds a new nullable column the
    // SELECT forgot to project.
    ticketRows = [
      fullTicketRow({
        siteName: null,
        vendorName: null,
        vendorLogoUrl: null,
        workTypeName: null,
        fieldEmployeeName: null,
        fieldEmployeeId: null,
        partnerName: null,
        partnerLogoUrl: null,
        afe: null,
        unlockedAt: null,
        unlockedById: null,
        unlockedByName: null,
        createdById: null,
        createdByName: null,
        closedById: null,
        closedByName: null,
        lifecycleState: null,
        enRouteAt: null,
        arrivedAt: null,
        departureLatitude: null,
        departureLongitude: null,
        siteLatitude: null,
        siteLongitude: null,
        siteRadiusMeters: null,
        scheduledStartAt: null,
        scheduledDurationMinutes: null,
        foremanUserId: null,
        intakeChannel: null,
        paymentMethod: null,
        paymentReference: null,
        paymentNote: null,
        paymentDispersedAt: null,
        paymentDispersedById: null,
        paymentDispersedByName: null,
        paymentReceiptUrl: null,
      }),
    ];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  // Sanity check: prove the assertion above is not vacuous. If
  // `ticketSelect` stopped projecting a required column (here `id`,
  // which the schema marks as a non-nullable number), the response body
  // would be missing it and ListTicketsResponse would reject the
  // payload — which is exactly the regression we want to catch. We
  // simulate that by returning a row that lacks `id` from the
  // underlying SELECT.
  it("regression guard: a missing required column would surface as a 500", async () => {
    const { id: _drop, ...ticketWithoutId } = fullTicketRow();
    ticketRows = [ticketWithoutId];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", adminCookie);

    // sendResponse() calls ListTicketsResponse.parse(...) before
    // responding; a missing required column makes that throw, which
    // Express turns into a 500. The point is that this test catches the
    // drift before users do.
    expect(res.status).toBe(500);
  });
});
