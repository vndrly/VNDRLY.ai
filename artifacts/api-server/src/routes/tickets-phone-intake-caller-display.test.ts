import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Task #508 — surface the phone-intake caller name on GET /tickets/:id so
// the web/mobile ticket-detail UI can render it. The route reads the
// earliest ticket_status_history row for the ticket and extracts the
// caller name when its reason starts with `phone_intake_caller:`. This
// test pins:
//   * earliest reason with the documented prefix → caller string returned
//   * earliest reason without the prefix → phoneIntakeCallerName=null
//     (so unrelated reasons like "ticket created" / "auto-check-in via
//     geofence" / kickback notes never get mistaken for caller names)
//   * no history rows at all → phoneIntakeCallerName=null
//   * trailing whitespace in the persisted name is trimmed
//
// The chained-mock here uses a `selectQueue` shaped exactly like the
// other tickets route tests (see tickets-phone-intake.test.ts) so the
// route's two reads in GET /tickets/:id (ticketQuery + history lookup)
// resolve in order without leaking across tests.


const cookieFor = (s: object) => buildTestCookie(s);

let selectQueue: any[][] = [];
let ticketRow: any = null;

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
      orderBy: () => ({
        limit: () => Promise.resolve(rows),
        then: (resolve: any) => Promise.resolve(rows).then(resolve),
      }),
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
      // Pop the next planned read off the queue. Falling through to
      // [ticketRow] keeps any incidental queries (like the ownership
      // guard) returning a usable row even after the queue is drained.
      const rows = selectQueue.length > 0 ? selectQueue.shift()! : [ticketRow];
      return makeChain(rows);
    },
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
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

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

beforeEach(async () => {
  // Task #769: row shape comes from `makeTicketRow`, the single source
  // of truth for the `ticketSelect` projection. The overrides below pin
  // only the columns the phone-intake caller-name route actually cares
  // about (status=in_progress and the office intake channel that
  // matches the test scenario); every other required field lives in
  // the helper so a future schema addition fails the helper's drift
  // guard instead of silently turning these tests into 500s.
  // `partnerId` is an extra column required by ensureFieldOwnership's
  // projected row; the response Zod parse strips unknown extras so
  // it's harmless for the GET /tickets/:id payload.
  ticketRow = makeTicketRow({
    status: "in_progress",
    vendorId: 11,
    partnerId: 5,
    intakeChannel: "office_on_behalf_of_partner",
    checkInTime: null,
  });
  selectQueue = [];

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /tickets/:id phoneIntakeCallerName", () => {
  it("returns the caller name when the initial transition reason carries the phone_intake_caller: prefix", async () => {
    selectQueue = [
      [ticketRow], // ticketQuery() result
      [{ reason: "phone_intake_caller:Pat Partner" }], // initial transition
    ];
    const r = await request(app).get("/api/tickets/42").set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.phoneIntakeCallerName).toBe("Pat Partner");
  });

  it("trims surrounding whitespace from the persisted caller name", async () => {
    selectQueue = [
      [ticketRow],
      [{ reason: "phone_intake_caller:   Frank Foreman   " }],
    ];
    const r = await request(app).get("/api/tickets/42").set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.phoneIntakeCallerName).toBe("Frank Foreman");
  });

  it("returns null when the earliest reason is not a phone_intake_caller line", async () => {
    // Regression guard: a non-phone-intake ticket's initial reason
    // ("ticket created", "auto-check-in via geofence", a kickback note,
    // …) must NEVER be surfaced as a caller name. The route checks the
    // documented prefix and falls through to null otherwise.
    selectQueue = [[ticketRow], [{ reason: "auto-check-in via geofence" }]];
    const r = await request(app).get("/api/tickets/42").set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.phoneIntakeCallerName).toBeNull();
  });

  it("returns null when the ticket has no transition history rows at all", async () => {
    selectQueue = [[ticketRow], []];
    const r = await request(app).get("/api/tickets/42").set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.phoneIntakeCallerName).toBeNull();
  });

  it("returns null when the prefix is present but the name is empty after trimming", async () => {
    selectQueue = [[ticketRow], [{ reason: "phone_intake_caller:   " }]];
    const r = await request(app).get("/api/tickets/42").set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.phoneIntakeCallerName).toBeNull();
  });
});
