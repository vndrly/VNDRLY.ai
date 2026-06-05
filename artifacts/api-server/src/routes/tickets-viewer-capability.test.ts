import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { makeTicketRow } from "../test-utils/ticket-row";

// Task #497 — capability matrix for GET /tickets/:id `viewerCanDisperseFunds`.
// The web/mobile UI hides the Disperse Funds action by default; the server
// turns it on per-request based on session role and AP wiring. We assert:
//   * admin => always true
//   * partner with AP role on their partner => true
//   * partner without AP role => false
//   * vendor session => false (server falls through, vendor never AP)
// The route uses session.partnerId (already verified by the ownership guard)
// not ticket.partnerId, so we don't need to wire partnerId through the row.


const cookieFor = (s: object) => buildTestCookie(s);

let ticketRow: any = null;
let hasApRole = false;
const userHasApRoleSpy = vi.fn();

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
      // Support both `.where().orderBy()` (returns rows directly) and
      // `.where().orderBy().limit()` (Task #508's history lookup).
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
  userHasApRole: vi.fn(async (...args: any[]) => {
    userHasApRoleSpy(...args);
    return hasApRole;
  }),
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => makeChain([ticketRow].filter(Boolean)),
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

const partnerCookie = cookieFor({
  userId: 7,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

const vendorCookie = cookieFor({
  userId: 9,
  role: "vendor",
  vendorId: 11,
  partnerId: null,
});

beforeEach(async () => {
  hasApRole = false;
  userHasApRoleSpy.mockClear();
  // Task #584: row shape comes from `makeTicketRow`, the single source
  // of truth for the `ticketSelect` projection. Adding a new required
  // field to `GetTicketResponse` via codegen now fails the factory's
  // typecheck (and module-load drift guard) instead of silently
  // turning every test in this file into a 500.
  // `partnerId` is an extra column required by ensureFieldOwnership's
  // projected row; the response Zod parse strips unknown extras so it's
  // harmless for the GET /tickets/:id payload.
  ticketRow = makeTicketRow({
    partnerId: 5,
  });

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  // Task #716 — shared middleware copies ZodError issues into the response
  // body so a future fixture-shape drift (e.g. forgetting to add the next
  // `intakeChannel`-style field) shows the failing path in the body instead
  // of an opaque generic 500.
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /tickets/:id viewerCanDisperseFunds", () => {
  it("admin viewer always sees viewerCanDisperseFunds=true (no AP lookup needed)", async () => {
    const r = await request(app)
      .get("/api/tickets/42")
      .set("Cookie", adminCookie);
    expectStatus(r, 200);
    expect(r.body.viewerCanDisperseFunds).toBe(true);
    expect(userHasApRoleSpy).not.toHaveBeenCalled();
  });

  it("partner viewer with AP role sees viewerCanDisperseFunds=true", async () => {
    hasApRole = true;
    const r = await request(app)
      .get("/api/tickets/42")
      .set("Cookie", partnerCookie);
    expectStatus(r, 200);
    expect(r.body.viewerCanDisperseFunds).toBe(true);
    // Confirm the helper is called with the *session* partnerId, not the
    // (unselected) ticket.partnerId — this is the bug the architect caught.
    expect(userHasApRoleSpy).toHaveBeenCalledWith(7, 5);
  });

  it("partner viewer WITHOUT AP role sees viewerCanDisperseFunds=false", async () => {
    hasApRole = false;
    const r = await request(app)
      .get("/api/tickets/42")
      .set("Cookie", partnerCookie);
    expectStatus(r, 200);
    expect(r.body.viewerCanDisperseFunds).toBe(false);
    expect(userHasApRoleSpy).toHaveBeenCalledWith(7, 5);
  });

  it("vendor viewer always sees viewerCanDisperseFunds=false (no AP lookup)", async () => {
    hasApRole = true; // even if a stale wiring would say yes
    const r = await request(app)
      .get("/api/tickets/42")
      .set("Cookie", vendorCookie);
    expectStatus(r, 200);
    expect(r.body.viewerCanDisperseFunds).toBe(false);
    expect(userHasApRoleSpy).not.toHaveBeenCalled();
  });
});