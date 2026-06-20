import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for the mobile open-tickets expansion across roles:
// field_employee, vendor admin, partner, and platform admin. Each
// role gets a tailored iOS experience while sharing the same
// denormalized row shape on GET /api/field/open-tickets and
// GET /api/field/open-tickets/:id.

const FIELD_USER_ID = 200;
const VENDOR_USER_ID = 201;
const PARTNER_USER_ID = 202;
const VENDOR_ID = 3;

const PARTNER_ID = 7;

const fieldCookie = buildTestCookie({
  userId: FIELD_USER_ID,
  role: "field_employee",
  vendorId: VENDOR_ID,
  partnerId: null,
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
  partnerId: 7,
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
});

// The route runs a small, predictable sequence of SELECTs depending on
// which auth path we go through. We don't need the full predicate-aware
// store from field.test.ts — just the right sequence of resolved rows,
// in order. Each test seeds `selectQueue` with the rows the handler
// will see for each `db.select(...)` call.
type RowProvider = () => any[];
let selectQueue: RowProvider[] = [];

function makeChain(rowsProvider: RowProvider) {
  const run = () => rowsProvider();
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
    select: (_projection?: Record<string, any>) => {
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
  // Many tables are referenced via the route's imports; tagging keeps the
  // mock honest about which table the SQL builder is reading from. We don't
  // assert against these here — `selectQueue` is the source of truth.
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
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    notificationsTable: tableTag("notifications"),
    pushTokensTable: tableTag("pushTokens"),
    ticketStatusEnum: { enumValues: [] },
    geofenceBypassesTable: tableTag("geofenceBypasses"),
    foremanCheckinsTable: tableTag("foremanCheckins"),
    sessionsTable: tableTag("sessions"),
    ticketChecklistResponsesTable: tableTag("ticketChecklistResponses"),
    workTypeChecklistsTable: tableTag("workTypeChecklists"),
    workTypeChecklistItemsTable: tableTag("workTypeChecklistItems"),
    auditLogsTable: tableTag("auditLogs"),
    twilioConfigsTable: tableTag("twilioConfigs"),
    siteContactsTable: tableTag("siteContacts"),
    siteWorkTypeContactsTable: tableTag("siteWorkTypeContacts"),
    smsLogsTable: tableTag("smsLogs"),
    ticketShareLinksTable: tableTag("ticketShareLinks"),
    siteFilesTable: tableTag("siteFiles"),
    ticketAttachmentsTable: tableTag("ticketAttachments"),
    invoicesTable: tableTag("invoices"),
    invoiceLineItemsTable: tableTag("invoiceLineItems"),
    timesheetsTable: tableTag("timesheets"),
    apiKeysTable: tableTag("apiKeys"),
    portalSessionsTable: tableTag("portalSessions"),
    rateLimitTable: tableTag("rateLimit"),
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
    isNotNull: passthrough,
    inArray: passthrough,
    sql: sqlTag,
    desc: passthrough,
    asc: passthrough,
    gte: passthrough,
    lte: passthrough,
    aliasedTable: (t: any) => t,
    or: passthrough,
  };
});

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  selectQueue = [];
  const router = (await import("./field")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

function fieldEmployeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    vendorId: VENDOR_ID,
    firstName: "Joe",
    lastName: "Boggs",
    email: "joe@winchester.com",
    isActive: true,
    vendorName: "Winchester",
    ...overrides,
  };
}

function vendorRow(overrides: Record<string, unknown> = {}) {
  return { id: VENDOR_ID, name: "Winchester", ...overrides };
}

function partnerRow(overrides: Record<string, unknown> = {}) {
  return { id: PARTNER_ID, name: "ACME Partner", ...overrides };
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    status: "in_progress",
    checkInTime: new Date("2026-04-30T15:00:00.000Z"),
    siteLocationId: 1,
    siteName: "Pad 12",
    partnerName: "ACME",
    workTypeId: 5,
    workTypeName: "Pumping",
    fieldEmployeeId: 50,
    fieldEmployeeFirstName: "Joe",
    fieldEmployeeLastName: "Boggs",
    createdAt: new Date("2026-04-30T14:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/field/open-tickets — auth gating", () => {
  it("401s when no session cookie is present", async () => {
    const res = await request(app).get("/api/field/open-tickets");
    expect(res.status).toBe(401);
  });

  it("returns 200 for a partner session scoped to partner sites", async () => {
    selectQueue = [
      () => [partnerRow()],
      () => [
        ticketRow({ id: 201, status: "kicked_back", vendorName: "Winchester" }),
        ticketRow({ id: 202, status: "submitted", vendorName: "Winchester" }),
        ticketRow({ id: 203, status: "approved", vendorName: "Winchester" }),
        ticketRow({ id: 204, status: "awaiting_payment", vendorName: "Winchester" }),
        ticketRow({ id: 205, status: "completed", vendorName: "Winchester" }),
      ],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(5);
    expect(res.body.map((r: { id: number }) => r.id).sort()).toEqual([201, 202, 203, 204, 205]);
  });
});

describe("GET /api/field/open-tickets — field_employee mode", () => {
  it("returns 200 with rows scoped to the field employee's vendor", async () => {
    selectQueue = [
      // requireFieldUser: vendor_people lookup
      () => [fieldEmployeeRow()],
      // route SELECT: tickets list
      () => [ticketRow(), ticketRow({ id: 102, status: "initiated" })],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(101);
  });

  it("403s when the field-employee row is inactive", async () => {
    selectQueue = [() => [fieldEmployeeRow({ isActive: false })]];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", fieldCookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("field.account_inactive");
  });
});

describe("GET /api/field/open-tickets — vendor admin mode", () => {
  it("returns 200 with all open tickets for the vendor", async () => {
    selectQueue = [
      // requireFieldOrVendor: vendor lookup
      () => [vendorRow()],
      // route SELECT: tickets list (all field employees on this vendor)
      () => [
        ticketRow({ fieldEmployeeId: 50 }),
        ticketRow({
          id: 102,
          fieldEmployeeId: 51,
          fieldEmployeeFirstName: "Sue",
          fieldEmployeeLastName: "Jones",
          status: "initiated",
        }),
        ticketRow({
          id: 103,
          fieldEmployeeId: null,
          fieldEmployeeFirstName: null,
          fieldEmployeeLastName: null,
          status: "kicked_back",
        }),
      ],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", vendorCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(3);
    // Vendor admin path returns rows from multiple field employees,
    // including unassigned tickets — proves the fieldEmployeeId filter
    // is dropped on the vendor branch.
    const ids = res.body.map((r: any) => r.id).sort();
    expect(ids).toEqual([101, 102, 103]);
    const employeeIds = res.body.map((r: any) => r.fieldEmployeeId);
    expect(employeeIds).toContain(50);
    expect(employeeIds).toContain(51);
    expect(employeeIds).toContain(null);
  });

  it("403s when the vendor row is missing", async () => {
    selectQueue = [() => []];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", vendorCookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/field/open-tickets/:id — auth gating + vendor mode", () => {
  it("401s when no session cookie is present", async () => {
    const res = await request(app).get("/api/field/open-tickets/101");
    expect(res.status).toBe(401);
  });

  it("returns the row for the field employee", async () => {
    selectQueue = [
      () => [fieldEmployeeRow()],
      () => [ticketRow()],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets/101")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    expect(res.body.id).toBe(101);
  });

  it("returns the row for a vendor admin (no fieldEmployeeId filter)", async () => {
    selectQueue = [
      () => [vendorRow()],
      // The route still scopes by vendorId; a row owned by ANOTHER
      // employee on the same vendor should resolve for the admin.
      () => [ticketRow({ id: 102, fieldEmployeeId: 99 })],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets/102")
      .set("Cookie", vendorCookie);
    expectStatus(res, 200);
    expect(res.body.id).toBe(102);
    expect(res.body.fieldEmployeeId).toBe(99);
  });

  it("404s when no row matches (vendor admin)", async () => {
    selectQueue = [() => [vendorRow()], () => []];
    const res = await request(app)
      .get("/api/field/open-tickets/999")
      .set("Cookie", vendorCookie);
    expect(res.status).toBe(404);
  });

  it("400s on a non-numeric id", async () => {
    selectQueue = [() => [vendorRow()]];
    const res = await request(app)
      .get("/api/field/open-tickets/not-a-number")
      .set("Cookie", vendorCookie);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/field/me — vendor admin mode", () => {
  it("returns viewerRole=vendor with vendor info for a vendor session", async () => {
    selectQueue = [
      // requireFieldOrVendor: vendor lookup
      () => [vendorRow({ name: "Winchester" })],
      // route SELECT: vendor logo lookup
      () => [{ logoUrl: "https://cdn.example/logo.png", name: "Winchester" }],
    ];
    const res = await request(app)
      .get("/api/field/me")
      .set("Cookie", vendorCookie);
    expectStatus(res, 200);
    expect(res.body.viewerRole).toBe("vendor");
    expect(res.body.vendorId).toBe(VENDOR_ID);
    expect(res.body.vendorName).toBe("Winchester");
    expect(res.body.employeeId).toBeNull();
    expect(res.body.vendorLogoUrl).toBe("https://cdn.example/logo.png");
  });

  it("returns viewerRole=field_employee with full payload for a field session", async () => {
    selectQueue = [
      () => [fieldEmployeeRow()],
      // /field/me's vendor-extras lookup on the field path
      () => [
        {
          profilePhotoPath: null,
          photoUrl: null,
          jobTitle: "Foreman",
          phone: "555-1212",
          pecExpirationDate: null,
          pecCertification: true,
          vendorLogoUrl: null,
        },
      ],
    ];
    const res = await request(app)
      .get("/api/field/me")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    expect(res.body.viewerRole).toBe("field_employee");
    expect(res.body.employeeId).toBe(50);
    expect(res.body.firstName).toBe("Joe");
    expect(res.body.jobTitle).toBe("Foreman");
  });

  it("401s when no session cookie is present", async () => {
    const res = await request(app).get("/api/field/me");
    expect(res.status).toBe(401);
  });

  it("returns viewerRole=partner with partner info for a partner session", async () => {
    selectQueue = [
      () => [partnerRow({ name: "Globex Partner" })],
      () => [{ logoUrl: null, name: "Globex Partner" }],
    ];
    const res = await request(app)
      .get("/api/field/me")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body.viewerRole).toBe("partner");
    expect(res.body.partnerId).toBe(PARTNER_ID);
    expect(res.body.partnerName).toBe("Globex Partner");
    expect(res.body.employeeId).toBeNull();
  });

  it("403s when the partner row is missing", async () => {
    selectQueue = [() => []];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(403);
  });
});
