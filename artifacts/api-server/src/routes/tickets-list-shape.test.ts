import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { ListTicketsResponse } from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

// Regression coverage for the ticket-list endpoint
// `GET /api/tickets`. This is the read behind the web ticket board
// and the mobile crew list — i.e. the primary tickets surface for
// every authenticated user — and it feeds the shared `ticketSelect`
// projection (via `ticketQuery()`) directly into
// `ListTicketsResponse.parse(...)` inside `sendResponse`. That makes
// it vulnerable to the same Task #537 drift class the single-ticket
// detail endpoint carries (covered by `tickets-detail-shape.test.ts`
// after Task #581): a column added to the response schema but
// forgotten in `ticketSelect` would 500 the entire ticket-list page,
// not just one detail view.
//
// The mock pattern mirrors `tickets-detail-shape.test.ts` /
// `tickets-portal-open-tickets.test.ts`: the stubbed `db.select(...)`
// honors the projection passed to it so an out-of-sync `ticketSelect`
// will faithfully drop the missing column from the row, and
// `ListTicketsResponse.safeParse(...)` will catch the drift in
// seconds — long before a browser e2e or, worse, real users would.

const ADMIN_USER_ID = 99;
const VENDOR_USER_ID = 71;
const VENDOR_ID = 11;
const PARTNER_USER_ID = 33;
const PARTNER_ID = 7;
const TICKET_ID = 4242;
const SITE_LOCATION_ID = 1;

const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
  // `decodeSession()` rejects sessions without `exp`; pin a far-future
  // expiry so the cookie stays valid for the whole test run.
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

const vendorCookie = buildTestCookie({
  userId: VENDOR_USER_ID,
  role: "vendor",
  vendorId: VENDOR_ID,
  partnerId: null,
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

const partnerCookie = buildTestCookie({
  userId: PARTNER_USER_ID,
  role: "partner",
  vendorId: null,
  partnerId: PARTNER_ID,
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

// Per-test fixture state — populated by each case, consumed by the
// projection-honoring db mock.
let ticketRows: any[] = [];

// Honors the projection passed to db.select(...) — only returns the
// keys the route actually asked for. This is what locks the contract:
// if `ticketSelect` stops projecting a column the response schema
// requires, the mock faithfully drops it and
// `ListTicketsResponse.safeParse(...)` rejects the payload.
function projectRows(
  projection: Record<string, any> | undefined,
  rows: any[],
): any[] {
  if (!projection) return rows;
  const keys = Object.keys(projection);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = row[k];
    return out;
  });
}

// A thenable chain that supports the fluent shapes the route uses:
//   * await chain                          — `db.select(...).from(...).leftJoin(...).where(...)`
//   * chain.where(...).orderBy(...)        — list query with conditions
//   * chain.orderBy(...)                   — list query without conditions (admin, no filters)
function makeChain(
  projection: Record<string, any> | undefined,
  rowsProvider: () => any[],
) {
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

// Dispatch each `db.select(projection)` call to the right fixture by
// inspecting the projection keys, rather than by call-index. This keeps
// the mock stable across role-specific call orderings — admin / vendor
// / partner all funnel through `ticketQuery()` here, which uses the
// shared `ticketSelect` projection.
function pickProvider(projection?: Record<string, any>): () => any[] {
  if (!projection) return () => [];
  const keys = new Set(Object.keys(projection));
  // ticketSelect — the canonical projection driving the response shape.
  if (keys.has("id") && keys.has("siteLocationId") && keys.has("vendorId")) {
    return () => ticketRows;
  }
  return () => [];
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: (projection?: Record<string, any>) =>
      makeChain(projection, pickProvider(projection)),
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

// Side-effect imports the route pulls in at module load — stubbed so
// tests don't accidentally touch a real notifier / push service.
vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  findVendorUserIds: vi.fn(async () => [] as number[]),
  findPartnerUserIds: vi.fn(async () => [] as number[]),
}));
vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));
vi.mock("../lib/invoice-generator", () => ({
  enqueueInvoiceGenerationForTicket: vi.fn(async () => undefined),
}));
vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: vi.fn(async () => undefined),
}));

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  ticketRows = [];
  const router = (await import("./tickets")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  // Surface ZodError issues in the response body so a fixture-shape
  // drift fails with the bad path printed instead of an opaque 500.
  attachTestErrorMiddleware(app, { logErrors: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

// A complete ticket row that satisfies every key in `ticketSelect` (and
// therefore every required field on `ListTicketsResponseItem`). Tests
// that want to prove a column is required can strip a single key from
// this object before seeding.
function fullTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    siteLocationId: SITE_LOCATION_ID,
    vendorId: VENDOR_ID,
    fieldEmployeeId: 50,
    workTypeId: 5,
    status: "in_progress" as const,
    description: "Swap rod pump",
    notes: "Bring extra packing",
    kickbackReason: null,
    checkInTime: new Date("2025-01-02T15:00:00.000Z"),
    checkOutTime: null,
    checkInLatitude: 31.5,
    checkInLongitude: -97.1,
    checkOutLatitude: null,
    checkOutLongitude: null,
    siteName: "Test Pad 12",
    vendorName: "Permian Pumpers",
    vendorLogoUrl: "https://cdn.example/vendor.png",
    workTypeName: "Pumping",
    fieldEmployeeName: "Jane Doe",
    partnerName: "ACME Energy",
    partnerLogoUrl: "https://cdn.example/partner.png",
    createdAt: new Date("2025-01-02T14:00:00.000Z"),
    updatedAt: new Date("2025-01-02T15:30:00.000Z"),
    unlockedAt: null,
    unlockedById: null,
    unlockedByName: null,
    unlockCount: 0,
    createdById: ADMIN_USER_ID,
    createdByName: "Dispatcher Dan",
    closedById: null,
    closedByName: null,
    lifecycleState: "on_site" as const,
    enRouteAt: new Date("2025-01-02T14:30:00.000Z"),
    arrivedAt: new Date("2025-01-02T14:55:00.000Z"),
    departureLatitude: null,
    departureLongitude: null,
    siteLatitude: 31.5,
    siteLongitude: -97.1,
    siteRadiusMeters: 150,
    afe: "AFE-001",
    scheduledStartAt: new Date("2025-01-02T14:00:00.000Z"),
    scheduledDurationMinutes: 120,
    foremanUserId: null,
    intakeChannel: "office_on_behalf_of_partner" as const,
    paymentMethod: null,
    paymentReference: null,
    paymentNote: null,
    paymentDispersedAt: null,
    paymentDispersedById: null,
    paymentDispersedByName: null,
    paymentReceiptUrl: null,
    // Task #51 — server-computed unread-comment badge counter.
    unreadCommentCount: 0,
    ...overrides,
  };
}

describe("GET /api/tickets", () => {
  it("returns 401 when no session cookie is present", async () => {
    ticketRows = [fullTicketRow()];
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("admin happy path: response body parses cleanly against ListTicketsResponse", async () => {
    // Two rows — one fully populated, one with the join-derived columns
    // nullable so we exercise the nullable branch of every join in
    // `ticketSelect` end-to-end on the same request.
    ticketRows = [
      fullTicketRow(),
      fullTicketRow({
        id: TICKET_ID + 1,
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
    // The route already calls `ListTicketsResponse.parse(...)` before
    // responding via `sendResponse`, so a 200 here means the schema
    // accepted the payload — but we re-parse on the response body to
    // lock the contract end-to-end. Drop a column from `ticketSelect`
    // that the schema requires and this assertion fails with a clear
    // ZodError listing the offending path.
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].id).toBe(TICKET_ID);
      expect(parsed.data[0].siteName).toBe("Test Pad 12");
      expect(parsed.data[0].vendorName).toBe("Permian Pumpers");
      expect(parsed.data[0].intakeChannel).toBe("office_on_behalf_of_partner");
      expect(parsed.data[1].status).toBe("initiated");
      expect(parsed.data[1].lifecycleState).toBe("pending_arrival");
    }
  });

  it("admin happy path: tolerates an empty ticket list", async () => {
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

  it("admin happy path: keeps working when nullable schema fields come back null", async () => {
    // Most join-derived columns (siteName, vendorName, partnerName,
    // workTypeName, fieldEmployeeName, partner/vendor logo URLs, AFE,
    // payment audit, etc.) are nullable in the response schema — make
    // sure `ticketSelect` projects them in the nullable case too. This
    // would have caught the original outage if the schema gained a new
    // nullable column the SELECT forgot.
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
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });

  it("vendor happy path (tenant-scoped): response body parses cleanly against ListTicketsResponse", async () => {
    // Vendor sessions add `eq(ticketsTable.vendorId, session.vendorId)`
    // to the WHERE on the same `ticketQuery()` — i.e. the same
    // `ticketSelect` projection feeds the parser. The fixture mirrors
    // the vendor's own vendorId so the row would survive the WHERE in
    // production; the mock ignores conditions but seeds the right
    // ownership values for parity.
    ticketRows = [fullTicketRow({ vendorId: VENDOR_ID })];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", vendorCookie);

    expectStatus(res, 200);
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].id).toBe(TICKET_ID);
      expect(parsed.data[0].vendorId).toBe(VENDOR_ID);
    }
  });

  it("partner happy path (tenant-scoped): response body parses cleanly against ListTicketsResponse", async () => {
    // Partner sessions add `eq(siteLocationsTable.partnerId,
    // session.partnerId)` on top of the same `ticketQuery()`. Same
    // shape, same risk of `ticketSelect` drift — covered here.
    ticketRows = [fullTicketRow()];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", partnerCookie);

    expectStatus(res, 200);
    const parsed = ListTicketsResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].id).toBe(TICKET_ID);
      expect(parsed.data[0].partnerName).toBe("ACME Energy");
    }
  });

  // Sanity check: prove the assertion is not vacuous. If `ticketSelect`
  // stopped projecting a required column (here `id`, which the schema
  // marks as a non-nullable number — this is the exact Task #537 drift
  // pattern), the response body would be missing it and
  // `ListTicketsResponse.parse(...)` inside `sendResponse` would throw,
  // which our test error middleware turns into a 500 with the bad path
  // surfaced in the body. The point is that the test catches the drift
  // before users do.
  it("regression guard: a missing required column would surface as a 500", async () => {
    const { id: _drop, ...ticketWithoutId } = fullTicketRow();
    ticketRows = [ticketWithoutId];

    const res = await request(app)
      .get("/api/tickets")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(500);
    // The error middleware copies ZodError issues onto the body so a
    // future maintainer debugging this red test sees exactly which
    // column went missing.
    expect(res.body.name).toBe("ZodError");
  });
});
