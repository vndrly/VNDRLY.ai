import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { GetPortalOpenTicketsResponse } from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Regression coverage for the Field Operations Portal "Continue Ticket"
// surface. The handler at GET /api/portal/:siteCode/open-tickets feeds the
// shared `ticketSelect` projection (via `ticketQuery()`) directly into
// `GetPortalOpenTicketsResponse.parse(...)`. This is the same shape that
// caused the Task #537 outage on the sibling /portal/:siteCode route: when
// the response schema gains a new column but the SELECT does not project
// it, `parse(...)` throws inside the route, the portal short-circuits and
// the only thing that catches it today is a slow browser e2e. Mirroring
// the tickets-portal.test.ts setup, this test mounts the real router with
// a stubbed db and asserts the happy-path response body parses cleanly
// against GetPortalOpenTicketsResponse — dropping any column the schema
// requires from `ticketSelect` will fail this test in seconds.

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
// The handler runs two SELECTs:
//   Call #0: SELECT * FROM site_locations WHERE site_code = ? (no projection)
//   Call #1: ticketQuery() — SELECT <ticketSelect> FROM tickets LEFT JOIN ...
// Admin short-circuits verifySiteAccess so we never need a third call.
let siteRows: any[] = [];
let ticketRows: any[] = [];
let selectCallIndex = 0;

// Honors the projection passed to db.select(...) — only returns the keys
// the route actually asked for. This is what lets the test catch the
// Task #537 regression: if `ticketSelect` stops projecting a column the
// response schema requires, the mock will faithfully drop it from the row
// and GetPortalOpenTicketsResponse.parse(...) will throw inside the
// handler.
function projectRows(projection: Record<string, any> | undefined, rows: any[]): any[] {
  if (!projection) return rows;
  const keys = Object.keys(projection);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = row[k];
    return out;
  });
}

// A thenable chain that supports both `await chain` (e.g. site lookup
// ending in .where()) and longer fluent chains (e.g. ticketQuery() ending
// in .where().orderBy()) without losing the projection-aware row filter.
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
    select: (projection?: Record<string, any>) => {
      const idx = selectCallIndex++;
      // Call #0: site lookup (no projection → full row)
      // Call #1: ticketQuery() (full ticketSelect projection)
      const provider = idx === 0 ? () => siteRows : () => ticketRows;
      return makeChain(projection, provider);
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
  siteRows = [];
  ticketRows = [];
  selectCallIndex = 0;
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

// Minimal site row — the handler only reads `id` and `partnerId` off it.
// We keep the rest of the columns absent on purpose to keep this fixture
// honest about what the open-tickets route actually consumes.
function siteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    partnerId: 7,
    siteCode: "PAD-12",
    ...overrides,
  };
}

// A complete ticket row that satisfies every key in `ticketSelect` (and
// therefore every required field on GetPortalOpenTicketsResponseItem).
// Tests that want to prove a column is required can strip a single key
// from this object before seeding.
//
// Task #769: defaults come from `makeTicketRow` so a future column on
// `ticketSelect` / `GetTicketResponse` cannot drift past this test
// without a clear "missing X" error from the shared drift guard. The
// overrides here pin the realistic-looking values the assertions
// below check (siteName, vendorName, intakeChannel, etc.) without
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

describe("GET /api/portal/:siteCode/open-tickets", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await request(app).get("/api/portal/PAD-12/open-tickets");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 404 when no site matches the supplied siteCode", async () => {
    siteRows = [];
    const res = await request(app)
      .get("/api/portal/UNKNOWN/open-tickets")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
    expect(res.body.error).toBe("site_not_found");
  });

  it("happy path: response body parses cleanly against GetPortalOpenTicketsResponse", async () => {
    siteRows = [siteRow()];
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
      .get("/api/portal/PAD-12/open-tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    // The route already calls .parse(...) before responding, so a 200 here
    // means the schema accepted the payload — but we re-parse on the
    // response body to lock the contract end-to-end. If `ticketSelect`
    // ever drifts away from the schema again (the Task #537 outage
    // pattern), this assertion will fail with a clear ZodError.
    const parsed = GetPortalOpenTicketsResponse.safeParse(res.body);
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
    siteRows = [siteRow()];
    ticketRows = [];

    const res = await request(app)
      .get("/api/portal/PAD-12/open-tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = GetPortalOpenTicketsResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual([]);
    }
  });

  it("happy path: keeps working when nullable schema fields come back null", async () => {
    // Most join-derived columns (siteName, vendorName, partnerName,
    // workTypeName, fieldEmployeeName, partnerLogoUrl, vendorLogoUrl,
    // afe, etc.) are nullable in the response schema — make sure
    // ticketSelect projects them in the nullable case too. This would
    // have caught the original outage if the schema gained a new
    // nullable column the SELECT forgot.
    siteRows = [siteRow()];
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
      .get("/api/portal/PAD-12/open-tickets")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = GetPortalOpenTicketsResponse.safeParse(res.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  // Sanity check: prove the assertion is not vacuous. If `ticketSelect`
  // stopped projecting a required column (here `id`, which the schema
  // marks as a non-nullable number), the response body would be missing
  // it and GetPortalOpenTicketsResponse would reject the payload — which
  // is exactly the regression we want to catch. We simulate that by
  // returning a row that lacks `id` from the underlying SELECT.
  it("regression guard: a missing required column would surface as a 500", async () => {
    siteRows = [siteRow()];
    const { id: _drop, ...ticketWithoutId } = fullTicketRow();
    ticketRows = [ticketWithoutId];

    const res = await request(app)
      .get("/api/portal/PAD-12/open-tickets")
      .set("Cookie", adminCookie);

    // The route calls GetPortalOpenTicketsResponse.parse(...) before
    // responding; a missing required column makes that throw, which
    // Express turns into a 500. The point is that the test catches the
    // drift before users do.
    expect(res.status).toBe(500);
  });
});
