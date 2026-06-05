import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { GetPortalInfoResponse } from "@workspace/api-zod";
import { buildTestCookie } from "../test-utils/session";

// Regression coverage for the Field Operations Portal outage fixed in
// Task #537. The handler at GET /api/portal/:siteCode hand-rolls the SELECT
// for the site row and feeds the result into GetPortalInfoResponse.parse.
// When the response schema gains a new column but the SELECT does not,
// `parse(...)` throws inside the route, the portal short-circuits to "Site
// Not Found", and the only thing that catches it today is a slow browser
// e2e. This test mounts the real router with a stubbed db and asserts the
// happy-path response body parses cleanly against GetPortalInfoResponse —
// dropping any column the schema requires from the route's SELECT will
// fail this test in seconds.

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
let siteRows: any[] = [];
let assignmentRows: any[] = [];
// Sequence of result sets the route is expected to consume in order. The
// portal handler runs two SELECTs: first for the site row, then for the
// site_work_assignments rows. We dispatch by call order so the handler sees
// the site shape on call #1 and the assignments shape on call #2.
let selectCallIndex = 0;

// Honors the projection passed to db.select(...) — only returns the keys
// the route actually asked for. This is what lets the test catch the
// Task #537 regression: if the route's SELECT stops projecting a column
// the response schema requires, the mock will faithfully drop it from the
// row and GetPortalInfoResponse.parse(...) will throw inside the handler.
function projectRows(projection: Record<string, any> | undefined, rows: any[]): any[] {
  if (!projection) return rows;
  const keys = Object.keys(projection);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = row[k];
    return out;
  });
}

function makeChain(projection: Record<string, any> | undefined, rowsProvider: () => any[]) {
  const run = () => projectRows(projection, rowsProvider());
  const chain: any = {
    from: () => chain,
    where: () => Promise.resolve(run()),
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => Promise.resolve(run()),
    limit: () => Promise.resolve(run()),
  };
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
      // Call #0: SELECT ... FROM site_locations LEFT JOIN partners
      // Call #1: SELECT ... FROM site_work_assignments LEFT JOIN ...
      // Subsequent calls (e.g. verifySiteAccess for non-admin) get the
      // assignment shape too — admin short-circuits so we never hit them
      // in these tests.
      const provider = idx === 0 ? () => siteRows : () => assignmentRows;
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
  assignmentRows = [];
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

// A complete site row that satisfies every field the response schema lists
// for `siteLocation`. Tests that want to prove a column is required can
// strip a single key from this object before seeding.
function fullSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    partnerId: 7,
    name: "Test Pad 12",
    address: "123 County Road",
    latitude: 31.5,
    longitude: -97.1,
    siteCode: "PAD-12",
    state: "TX",
    isActive: true,
    status: "active" as const,
    siteRadiusMeters: 150,
    afe: "AFE-001",
    photoUrl: null,
    partnerName: "ACME Energy",
    // Task #158: portal route projects partner brand fields so the
    // QR-code page can paint partner colors. Mirror those columns in
    // the fixture or the response schema rejects them as undefined.
    partnerLogoUrl: null,
    partnerLogoSquareUrl: null,
    partnerBrandPrimaryColor: null,
    partnerBrandAccentColor: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fullAssignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    siteLocationId: 1,
    workTypeId: 5,
    vendorId: 3,
    workTypeName: "Pumping",
    workTypeCategory: "production",
    vendorName: "Permian Pumpers",
    afe: "AFE-001",
    ...overrides,
  };
}

describe("GET /api/portal/:siteCode", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await request(app).get("/api/portal/PAD-12");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 404 when no site matches the supplied siteCode", async () => {
    siteRows = [];
    const res = await request(app)
      .get("/api/portal/UNKNOWN")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
    expect(res.body.error).toBe("site_not_found");
  });

  it("happy path: response body parses cleanly against GetPortalInfoResponse", async () => {
    siteRows = [fullSiteRow()];
    assignmentRows = [
      fullAssignmentRow(),
      fullAssignmentRow({
        id: 11,
        workTypeId: 6,
        workTypeName: "Hot Shot",
        workTypeCategory: "logistics",
        vendorId: 4,
        vendorName: "Roadrunner Trucking",
        afe: null,
      }),
    ];

    const res = await request(app)
      .get("/api/portal/PAD-12")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    // The route already calls .parse(...) before responding, so a 200 here
    // means the schema accepted the payload — but we re-parse on the
    // response body to lock the contract end-to-end. If the route's SELECT
    // ever drifts away from the schema again (the Task #537 outage), this
    // assertion will fail with a clear ZodError.
    const parsed = GetPortalInfoResponse.safeParse(res.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocation.siteCode).toBe("PAD-12");
      expect(parsed.data.siteLocation.partnerName).toBe("ACME Energy");
      expect(parsed.data.availableWorkTypes).toHaveLength(2);
      expect(parsed.data.availableWorkTypes[0].vendorName).toBe("Permian Pumpers");
    }
  });

  it("happy path: tolerates an empty assignments list", async () => {
    siteRows = [fullSiteRow()];
    assignmentRows = [];

    const res = await request(app)
      .get("/api/portal/PAD-12")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = GetPortalInfoResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.availableWorkTypes).toEqual([]);
    }
  });

  it("happy path: keeps working when nullable schema fields come back null", async () => {
    // partnerName, state, siteRadiusMeters, and afe are all nullable in the
    // response schema — make sure the SELECT projects them in the nullable
    // case too (this would have caught the original outage if the schema
    // gained a new nullable column the SELECT forgot).
    siteRows = [
      fullSiteRow({
        partnerName: null,
        state: null,
        siteRadiusMeters: null,
        afe: null,
      }),
    ];
    assignmentRows = [fullAssignmentRow({ afe: null })];

    const res = await request(app)
      .get("/api/portal/PAD-12")
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    const parsed = GetPortalInfoResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  // Sanity check: prove the assertion is not vacuous. If the route stopped
  // projecting a required column (here `name`), the response body would be
  // missing it and GetPortalInfoResponse would reject the payload — which
  // is exactly the regression we want to catch. We simulate that by
  // returning a row that lacks `name` from the underlying SELECT.
  it("regression guard: a missing required column would surface as a 500", async () => {
    const { name: _drop, ...siteWithoutName } = fullSiteRow();
    siteRows = [siteWithoutName];
    assignmentRows = [];

    const res = await request(app)
      .get("/api/portal/PAD-12")
      .set("Cookie", adminCookie);

    // The route calls GetPortalInfoResponse.parse(...) before responding;
    // a missing required column makes that throw, which Express turns into
    // a 500. The point is that the test catches the drift before users do.
    expect(res.status).toBe(500);
  });
});
