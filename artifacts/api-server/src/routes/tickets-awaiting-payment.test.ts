import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #497 — partner-side AP queue. GET /tickets?awaitingPayment=true must
// add two SQL conditions: status = 'approved' AND paymentDispersedAt IS NULL.
// We assert by capturing the conditions array passed to the .where() chain
// and checking the column names + operator descriptors that drizzle records.


const cookieFor = (s: object) => buildTestCookie(s);

let returnedRows: any[] = [];
let lastWhereArgs: any = null;

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  chain.where = (...args: any[]) => {
    lastWhereArgs = args;
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

// Drizzle's `eq`/`isNull`/`and` are pass-through descriptors; we re-expose
// them from a stub so we can assert exactly which columns each call was
// constructed against.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
    isNull: (col: any) => ({ __op: "isNull", col }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
  };
});

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => makeChain(returnedRows),
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

const partnerCookie = cookieFor({
  userId: 7,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

beforeEach(async () => {
  returnedRows = [];
  lastWhereArgs = null;
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

describe("GET /tickets?awaitingPayment=true", () => {
  it("adds status='approved' AND paymentDispersedAt IS NULL conditions", async () => {
    const r = await request(app)
      .get("/api/tickets?awaitingPayment=true")
      .set("Cookie", partnerCookie);
    expectStatus(r, 200);

    // The route wraps all conditions in and(...). Pull them back out.
    expect(lastWhereArgs).toBeTruthy();
    const andDescriptor = lastWhereArgs[0];
    expect(andDescriptor.__op).toBe("and");
    const conds = andDescriptor.conds as Array<any>;

    // We expect the AP filter pair plus the partner tenancy clause.
    const eqStatusApproved = conds.find(
      (c) =>
        c.__op === "eq" && c.col?.__col === "status" && c.val === "approved",
    );
    expect(eqStatusApproved).toBeTruthy();

    const isNullPaymentDispersedAt = conds.find(
      (c) => c.__op === "isNull" && c.col?.__col === "paymentDispersedAt",
    );
    expect(isNullPaymentDispersedAt).toBeTruthy();

    // Partner tenancy still applies — we should not be widening the query.
    const eqPartnerId = conds.find(
      (c) =>
        c.__op === "eq" && c.col?.__col === "partnerId" && c.val === 5,
    );
    expect(eqPartnerId).toBeTruthy();
  });

  it("does NOT add the AP filter when awaitingPayment is omitted", async () => {
    const r = await request(app)
      .get("/api/tickets")
      .set("Cookie", partnerCookie);
    expectStatus(r, 200);

    const andDescriptor = lastWhereArgs?.[0];
    // With only the partner tenancy clause there's no need for and().
    if (andDescriptor?.__op === "and") {
      const conds = andDescriptor.conds as Array<any>;
      expect(
        conds.some(
          (c) => c.__op === "isNull" && c.col?.__col === "paymentDispersedAt",
        ),
      ).toBe(false);
      expect(
        conds.some((c) => c.__op === "eq" && c.val === "approved"),
      ).toBe(false);
    } else {
      // Single condition path: partner tenancy only.
      expect(andDescriptor?.__op).toBe("eq");
      expect(andDescriptor.col?.__col).toBe("partnerId");
    }
  });
});
