import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #572: regression coverage for the new "assignment removed mid-job"
// guard on the field-employee state-change endpoints. The mobile ticket
// detail screen relies on these structured codes to show its
// "contact dispatch / cancel ticket" banner instead of pinning a
// generic English error inline under whichever button just failed.
//
// What we assert (per state-change endpoint):
//   * Field employee whose vendor's (site, work_type) assignment was
//     removed: 400 with `{ error: "site_vendor_mismatch" }` or
//     `{ error: "work_type_not_allowed" }` depending on which row is
//     missing in the assignment table.
//   * Field employee whose vendor still has the assignment: the guard
//     waves them through and the handler advances to the next gate.
//   * Admin caller: the guard does NOT run, so the office can still
//     drive a ticket through its lifecycle for remediation even after
//     pulling the assignment.
//
// The DB layer is mocked with a per-test queue of select results so we
// can exercise the guard in isolation without standing up Postgres.
// (Mirrors the recipe in field-tickets-validation.test.ts.)


const cookieFor = (s: object) => buildTestCookie(s);

// Each `await db.select().from().where(...)` resolves to the next entry
// in this queue. Tests push the rows the handler will see in the order
// it reads them.
let selectQueue: any[] = [];
let updateReturning: any[] = [];

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  chain.where = () => {
    const next: any = {
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      leftJoin: () => next,
      innerJoin: () => next,
    };
    return next;
  };
  return chain;
}

vi.mock("../lib/ap-role", () => ({
  userHasApRole: vi.fn(async () => false),
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      const head = selectQueue.shift();
      // `head` may be a single object, an array of rows, or null/undefined
      // (meaning "no row"). Normalize to an array for makeChain.
      const rows = head == null ? [] : Array.isArray(head) ? head : [head];
      return makeChain(rows);
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturning),
        }),
      }),
    }),
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
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    ticketScheduleAuditTable: tableTag("ticketScheduleAudit"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    ticketStatusHistoryTable: tableTag("ticketStatusHistory"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

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

const fieldCookie = cookieFor({
  userId: 1234,
  role: "field_employee",
  vendorId: 11,
  partnerId: null,
});
const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const TICKET_ID = 7777;
const VENDOR_ID = 11;
const SITE_ID = 50;
const WORK_TYPE_ID = 60;
const FE_ID = 555;

// Row shapes the route handlers read in their guard sequence (see the
// per-test comments below for which call returns which row).
const ownershipRow = {
  vendorId: VENDOR_ID,
  fieldEmployeeId: FE_ID,
  partnerId: 5,
};
const vendorPersonRow = { id: FE_ID, vendorId: VENDOR_ID };
const ticketAssignmentRow = {
  vendorId: VENDOR_ID,
  siteLocationId: SITE_ID,
  workTypeId: WORK_TYPE_ID,
};
const acceptedTicketRow = { status: "in_progress" };

beforeEach(async () => {
  selectQueue = [];
  updateReturning = [];
  vi.resetModules();
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

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/check-in
// ─────────────────────────────────────────────────────────────────────────
//
// Field-employee select sequence on this endpoint:
//   1. ensureFieldOwnership  → ticket-with-siteLocations join
//   2. getFieldEmployeeForSession → vendorPeople row
//   3. ensureFieldAssignmentForFieldEmployee → ticket (vendor/site/wt)
//   4. ensureFieldAssignmentForFieldEmployee → assignments (combined)
//   5. (only when 4 missed) ensureFieldAssignmentForFieldEmployee →
//      assignments narrowed to (vendor, site)
//
// All asserts stop at the assignment guard's response, so we don't need
// to seed anything past step 5.
describe("POST /tickets/:id/check-in — Task #572 assignment guard", () => {
  it("emits site_vendor_mismatch when vendor lost their site assignment", async () => {
    selectQueue = [
      ownershipRow,            // (1) ensureFieldOwnership
      vendorPersonRow,         // (2) getFieldEmployeeForSession
      ticketAssignmentRow,     // (3) re-read for assignment check
      null,                    // (4) combined (vendor, site, wt) → missing
      null,                    // (5) narrowing (vendor, site) → also missing
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", fieldCookie)
      .send({ latitude: 30, longitude: -90 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_vendor_mismatch");
    expect(r.body.error).toBe("site_vendor_mismatch");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits work_type_not_allowed when site is still assigned but the work type isn't", async () => {
    selectQueue = [
      ownershipRow,
      vendorPersonRow,
      ticketAssignmentRow,
      null,                 // combined (vendor, site, wt) → missing
      { id: 88 },           // narrowing (vendor, site) → still assigned
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", fieldCookie)
      .send({ latitude: 30, longitude: -90 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.work_type_not_allowed");
    expect(r.body.error).toBe("work_type_not_allowed");
    expect(typeof r.body.message).toBe("string");
  });

  it("passes the assignment guard when the combined assignment row exists", async () => {
    // The combined assignment row is present, so the guard waves the
    // request through. We don't seed past the guard — the handler then
    // proceeds into its check-in transaction (which our mock returns no
    // updated row for, landing on a 404 ticket_not_found). The point is
    // that the *assignment* codes are NOT what surfaces.
    selectQueue = [
      ownershipRow,
      vendorPersonRow,
      ticketAssignmentRow,
      { id: 99 },             // combined assignment present → continue
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", fieldCookie)
      .send({ latitude: 30, longitude: -90 });
    expect(r.body.error).not.toBe("site_vendor_mismatch");
    expect(r.body.error).not.toBe("work_type_not_allowed");
  });

  it("does not run the assignment guard for admin callers", async () => {
    // Admin bypasses ensureFieldOwnership AND the new assignment guard
    // (the helper short-circuits when role !== field_employee). We
    // therefore expect the response to NOT carry the assignment codes
    // even when no assignment row exists at all — the queue here would
    // otherwise produce site_vendor_mismatch.
    selectQueue = [];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({ latitude: 30, longitude: -90 });
    expect(r.body.error).not.toBe("site_vendor_mismatch");
    expect(r.body.error).not.toBe("work_type_not_allowed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/submit — most complex select chain (also runs
// ensureAccepted between ownership and the assignment guard).
// ─────────────────────────────────────────────────────────────────────────
//
// Field-employee select sequence on this endpoint:
//   1. ensureFieldOwnership  → ticket-with-siteLocations join
//   2. getFieldEmployeeForSession → vendorPeople row
//   3. ensureAccepted → ticket (status only)
//   4. ensureFieldAssignmentForFieldEmployee → ticket (vendor/site/wt)
//   5. ensureFieldAssignmentForFieldEmployee → assignments (combined)
//   6. (only when 5 missed) ensureFieldAssignmentForFieldEmployee →
//      assignments narrowed to (vendor, site)
describe("POST /tickets/:id/submit — Task #572 assignment guard", () => {
  it("emits site_vendor_mismatch when vendor lost their site assignment mid-job", async () => {
    selectQueue = [
      ownershipRow,            // (1) ensureFieldOwnership
      vendorPersonRow,         // (2) getFieldEmployeeForSession
      acceptedTicketRow,       // (3) ensureAccepted
      ticketAssignmentRow,     // (4) re-read for assignment check
      null,                    // (5) combined → missing
      null,                    // (6) narrowing (vendor, site) → also missing
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/submit`)
      .set("Cookie", fieldCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_vendor_mismatch");
    expect(r.body.error).toBe("site_vendor_mismatch");
  });

  it("emits work_type_not_allowed when only the work type was removed", async () => {
    selectQueue = [
      ownershipRow,
      vendorPersonRow,
      acceptedTicketRow,
      ticketAssignmentRow,
      null,
      { id: 88 },
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/submit`)
      .set("Cookie", fieldCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.work_type_not_allowed");
    expect(r.body.error).toBe("work_type_not_allowed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/en-route — same guard wiring as check-in.
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/en-route — Task #572 assignment guard", () => {
  it("emits site_vendor_mismatch when vendor lost their site assignment", async () => {
    selectQueue = [
      ownershipRow,
      vendorPersonRow,
      ticketAssignmentRow,
      null,
      null,
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/en-route`)
      .set("Cookie", fieldCookie)
      .send({ latitude: 30, longitude: -90 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_vendor_mismatch");
    expect(r.body.error).toBe("site_vendor_mismatch");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/check-out — same guard wiring as submit.
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/check-out — Task #572 assignment guard", () => {
  it("emits work_type_not_allowed when only the work type was removed", async () => {
    selectQueue = [
      ownershipRow,
      vendorPersonRow,
      acceptedTicketRow,
      ticketAssignmentRow,
      null,
      { id: 88 },
    ];
    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/check-out`)
      .set("Cookie", fieldCookie)
      .send({ latitude: 30, longitude: -90, workCompleted: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.work_type_not_allowed");
    expect(r.body.error).toBe("work_type_not_allowed");
  });
});
