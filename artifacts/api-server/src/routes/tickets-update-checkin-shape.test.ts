import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  CheckInTicketResponse,
  UpdateTicketResponse,
} from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

// Task #1030 — Regression coverage for the ticket-mutation endpoints
// that feed the shared `ticketQuery()` / `ticketSelect` projection
// straight into `sendResponse(...)`:
//
//   • PATCH /api/tickets/:id      → UpdateTicketResponse
//   • POST  /api/tickets/:id/check-in → CheckInTicketResponse
//
// Both run on every inline edit in the dispatcher and every arrival
// ping from the field mobile app, and both pipe the result of
// `ticketQuery()` into `sendResponse(res, …Response, result)` — which
// runs a Zod parse server-side. A single column added to the response
// schema but forgotten in `ticketSelect` would flip these endpoints
// from a clean 200 into a 500, breaking ticket editing and arrivals.
//
// The mock pattern mirrors `tickets-detail-shape.test.ts`: the stubbed
// `db.select(...)` honors the projection passed to it so an out-of-sync
// `ticketSelect` will faithfully drop the column from the row, and
// `…Response.safeParse(...)` will catch the drift in seconds — long
// before a browser e2e or, worse, real users would.

const ADMIN_USER_ID = 99;
const TICKET_ID = 4242;
const SITE_LOCATION_ID = 1;
const VENDOR_ID = 11;

const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
  // `decodeSession()` rejects sessions without `exp`; pin a far-future
  // expiry so the cookie stays valid for the whole test run.
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

// ─── Per-test fixture state ────────────────────────────────────────────────
// Driven by the projection-honoring db mock below.

// Full ticket row returned by the final `ticketQuery()` SELECT — this
// is what the response schema parses. Tests can strip a key from this
// to prove the assertion is non-vacuous.
let ticketRows: any[] = [];

// Existing row read by the PATCH handler before the update, projected
// as `{ fieldEmployeeId, vendorId }`. Defaults to a sane row that
// matches the seeded ticket above.
let existingTicketRows: any[] = [];

// Site geofence pre-flight read in the check-in handler.
let siteGeofenceRows: any[] = [];

// CAS read inside the check-in transaction (`{ arrivedAt, status }`).
let casRows: any[] = [];

// Row that comes back from `db.update(...).returning()`.
let updatedRow: any = null;

// ─── Projection-honoring db mock (mirrors tickets-detail-shape) ───────────

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
// inspecting the projection keys. Stable across role-specific call
// orderings and against future routes added to the same handler.
function pickProvider(projection?: Record<string, any>): () => any[] {
  if (!projection) return () => [];
  const keys = new Set(Object.keys(projection));
  // ticketSelect — the canonical projection driving the response shape.
  if (keys.has("id") && keys.has("siteLocationId") && keys.has("vendorId")) {
    return () => ticketRows;
  }
  // PATCH pre-update read: `{ fieldEmployeeId, vendorId }` only.
  if (
    keys.size === 2 &&
    keys.has("fieldEmployeeId") &&
    keys.has("vendorId")
  ) {
    return () => existingTicketRows;
  }
  // Check-in geofence pre-flight: `{ latitude, longitude, siteRadiusMeters }`.
  if (
    keys.has("latitude") &&
    keys.has("longitude") &&
    keys.has("siteRadiusMeters")
  ) {
    return () => siteGeofenceRows;
  }
  // Check-in CAS read inside the transaction: `{ arrivedAt, status }`.
  if (keys.size === 2 && keys.has("arrivedAt") && keys.has("status")) {
    return () => casRows;
  }
  // ticket_check_ins open-row dedupe and vendor_people hourly-rate
  // lookups — return empty so the dual-write is a no-op.
  if (keys.size === 1 && (keys.has("id") || keys.has("hourlyRate"))) {
    return () => [];
  }
  // Vendor-people fieldEmployee→vendor check on PATCH (only `{ vendorId }`)
  // — the test never sets fieldEmployeeId on PATCH so this isn't reached;
  // return empty as a defensive default.
  if (keys.size === 1 && keys.has("vendorId")) return () => [];
  return () => [];
}

// `await db.update(...).set(...).where(...)` (no `.returning()`) and
// `await db.update(...).set(...).where(...).returning()` are both used
// by the routes under test; make the .where() return value both a
// thenable AND expose .returning().
function makeUpdateWhere() {
  const rows = updatedRow ? [updatedRow] : [];
  const obj: any = {
    returning: () => Promise.resolve(rows),
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(rows).catch(reject),
    finally: (cb: any) => Promise.resolve(rows).finally(cb),
  };
  return obj;
}

// `db.insert(...).values(...)` is awaited directly in the check-in
// handler (gps_logs, ticket_check_ins) AND chained as `.returning()`
// in other routes — make .values() both thenable and expose .returning().
function makeInsertValues() {
  const obj: any = {
    returning: () => Promise.resolve([]),
    then: (resolve: any, reject: any) =>
      Promise.resolve([]).then(resolve, reject),
    catch: (reject: any) => Promise.resolve([]).catch(reject),
    finally: (cb: any) => Promise.resolve([]).finally(cb),
  };
  return obj;
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
    insert: () => ({ values: () => makeInsertValues() }),
    update: () => ({ set: () => ({ where: () => makeUpdateWhere() }) }),
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

// Stub the AP-role lookup so admin path doesn't try to consult it.
vi.mock("../lib/ap-role", () => ({
  userHasApRole: vi.fn(async () => false),
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
}));

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
  existingTicketRows = [
    { fieldEmployeeId: 50, vendorId: VENDOR_ID },
  ];
  siteGeofenceRows = [
    { latitude: 31.5, longitude: -97.1, siteRadiusMeters: 150 },
  ];
  casRows = [{ arrivedAt: null, status: "in_progress" }];
  updatedRow = { id: TICKET_ID, fieldEmployeeId: 50 };
  const router = (await import("./tickets")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app, { logErrors: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

// A complete ticket row that satisfies every key in `ticketSelect`
// (and therefore every required field on `UpdateTicketResponse` and
// `CheckInTicketResponse`, which share the same projection).
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
    unreadCommentCount: 0,
    ...overrides,
  };
}

describe("PATCH /api/tickets/:id", () => {
  it("admin happy path: response body parses cleanly against UpdateTicketResponse", async () => {
    ticketRows = [fullTicketRow()];

    const res = await request(app)
      .patch(`/api/tickets/${TICKET_ID}`)
      .set("Cookie", adminCookie)
      .send({ notes: "Swap complete" });

    expectStatus(res, 200);
    // The route already calls `UpdateTicketResponse.parse(...)` before
    // responding via `sendResponse`, so a 200 here means the schema
    // accepted the payload — but we re-parse on the response body to
    // lock the contract end-to-end. Drop a column from `ticketSelect`
    // that the schema requires and this assertion fails with a clear
    // ZodError listing the offending path.
    const parsed = UpdateTicketResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(TICKET_ID);
      expect(parsed.data.siteName).toBe("Test Pad 12");
      expect(parsed.data.vendorName).toBe("Permian Pumpers");
    }
  });

  it("admin happy path: keeps working when nullable join columns come back null", async () => {
    // Most join-derived columns are nullable in the response schema —
    // make sure `ticketSelect` projects them in the nullable case too.
    // This would have caught the original outage if the schema gained a
    // new nullable column the SELECT forgot.
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
      .patch(`/api/tickets/${TICKET_ID}`)
      .set("Cookie", adminCookie)
      .send({ notes: "Edited" });

    expectStatus(res, 200);
    const parsed = UpdateTicketResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });

  // Sanity check: prove the assertion is not vacuous. If `ticketSelect`
  // stopped projecting a required column (here `id`, which the schema
  // marks as a non-nullable number — this is the exact Task #537 drift
  // pattern), the response body would be missing it and
  // `UpdateTicketResponse.parse(...)` inside `sendResponse` would throw,
  // which the test error middleware turns into a 500.
  it("regression guard: a missing required column would surface as a 500", async () => {
    const { id: _drop, ...ticketWithoutId } = fullTicketRow();
    ticketRows = [ticketWithoutId];

    const res = await request(app)
      .patch(`/api/tickets/${TICKET_ID}`)
      .set("Cookie", adminCookie)
      .send({ notes: "Will fail" });

    expect(res.status).toBe(500);
    expect(res.body.name).toBe("ZodError");
  });
});

describe("POST /api/tickets/:id/check-in", () => {
  it("admin happy path: response body parses cleanly against CheckInTicketResponse", async () => {
    ticketRows = [fullTicketRow()];

    const res = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({ latitude: 31.5, longitude: -97.1 });

    expectStatus(res, 200);
    const parsed = CheckInTicketResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(TICKET_ID);
      expect(parsed.data.status).toBe("in_progress");
    }
  });

  it("admin happy path: keeps working when nullable join columns come back null", async () => {
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
        departureLatitude: null,
        departureLongitude: null,
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
    // No primary field employee on the updated row → skips the
    // ticket_check_ins dual-write entirely.
    updatedRow = { id: TICKET_ID, fieldEmployeeId: null };

    const res = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({ latitude: 31.5, longitude: -97.1 });

    expectStatus(res, 200);
    const parsed = CheckInTicketResponse.safeParse(res.body);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });

  // Sanity check: same drift guard as PATCH.
  it("regression guard: a missing required column would surface as a 500", async () => {
    const { id: _drop, ...ticketWithoutId } = fullTicketRow();
    ticketRows = [ticketWithoutId];

    const res = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({ latitude: 31.5, longitude: -97.1 });

    expect(res.status).toBe(500);
    expect(res.body.name).toBe("ZodError");
  });
});
