import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Coverage for Task #497 — POST /tickets/:id/disperse-funds.
//
// Same chained-mock recipe as tickets-direct-award.test.ts. We assert:
//   * unauthenticated and non-AP callers are rejected
//   * paymentMethod=check requires a paymentReference
//   * the only legal pre-state is status='approved'
//   * the happy path commits the payment columns + flips status,
//     records a transition row, and notifies vendor users


const cookieFor = (s: object) => buildTestCookie(s);

// Per-test mutable rows the chained-mock DB returns.
let existingRow: any = null;
let updatedRow: any = null;
let ticketQueryRow: any = null;
let updateSetSpy = vi.fn();
let hasApRole = false;

function makeChain(rows: any) {
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
  userHasApRole: vi.fn(async () => hasApRole),
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  let selectStep = 0;
  const db: any = {
    select: () => {
      // Read order in /tickets/:id/disperse-funds:
      //   0: pre-check select on tickets+sites (existingRow)
      //   1+: post-tx ticketQuery() join (ticketQueryRow)
      const seq = [
        () => makeChain([existingRow].filter(Boolean)),
      ];
      const fn = seq[selectStep] ?? (() => makeChain([ticketQueryRow].filter(Boolean)));
      selectStep += 1;
      return fn();
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({
      set: (vals: any) => {
        updateSetSpy(vals);
        return {
          where: () => ({
            returning: () => Promise.resolve(updatedRow ? [updatedRow] : []),
          }),
        };
      },
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  (db as any).__resetSelectStep = () => {
    selectStep = 0;
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
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

const notifyUsersMock = vi.fn(async (..._args: unknown[]) => undefined);
const findVendorUserIdsMock = vi.fn(async () => [99, 100]);

vi.mock("./notifications", () => ({
  notifyUsers: notifyUsersMock,
  findVendorUserIds: findVendorUserIdsMock,
  findPartnerUserIds: vi.fn(async () => [] as number[]),
}));

vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

vi.mock("../lib/invoice-generator", () => ({
  enqueueInvoiceGenerationForTicket: vi.fn(async () => undefined),
}));

const recordTransitionMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: recordTransitionMock,
}));

let app: express.Express;

const partnerCookie = cookieFor({
  userId: 7,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const otherPartnerCookie = cookieFor({
  userId: 8,
  role: "partner",
  vendorId: null,
  partnerId: 999,
});

const vendorCookie = cookieFor({
  userId: 9,
  role: "vendor",
  vendorId: 11,
  partnerId: null,
});

beforeEach(async () => {
  hasApRole = false;
  existingRow = {
    ticketId: 42,
    partnerId: 5,
    vendorId: 11,
    status: "approved",
  };
  updatedRow = {
    id: 42,
    status: "funds_dispersed",
    paymentMethod: "etf",
    paymentReference: null,
    paymentNote: null,
  };
  // Task #584: row shape comes from `makeTicketRow`, the single source
  // of truth for the `ticketSelect` projection. Fields newly required
  // by `GetTicketResponse` (e.g. Task #498's `intakeChannel`) are
  // populated automatically — no more silent 500s when codegen adds a
  // column and this fixture forgets it.
  ticketQueryRow = makeTicketRow({
    status: "funds_dispersed",
    paymentMethod: "etf",
    paymentDispersedAt: new Date(),
    paymentDispersedById: 7,
    paymentDispersedByName: "Pat AP",
  });
  updateSetSpy = vi.fn();
  notifyUsersMock.mockClear();
  findVendorUserIdsMock.mockClear();
  recordTransitionMock.mockClear();

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  attachTestErrorMiddleware(app);
  // Reset the selectStep counter inside the chained-mock between calls.
  const { db } = await import("@workspace/db");
  (db as any).__resetSelectStep?.();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /tickets/:id/disperse-funds", () => {
  it("rejects unauthenticated callers", async () => {
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("auth.not_authenticated");
    expect(r.body.error).toBe("not_authenticated");
  });

  it("rejects non-AP partner users (role check)", async () => {
    hasApRole = false;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(r.body.error).toBe("forbidden_not_ap");
  });

  it("rejects partner users from a different partner (tenancy)", async () => {
    hasApRole = true; // even if they have AP role somewhere, it's not THIS partner
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", otherPartnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(r.body.error).toBe("forbidden_not_ap");
  });

  it("rejects vendor callers", async () => {
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", vendorCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(r.body.error).toBe("forbidden_not_ap");
  });

  it("requires paymentReference for paymentMethod=check", async () => {
    hasApRole = true;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "check" });
    expect(r.status).toBe(400);
    // Task #527: structured snake_case code; the human-readable string
    // moves to `message`. The dedicated tickets-mutation-codes.test.ts
    // file owns the expanded coverage for the rest of the catalog.
    expect(r.body.code).toBe("ticket.payment_reference_required");
    expect(r.body.error).toBe("payment_reference_required");
    expect(r.body.message).toMatch(/paymentReference/i);
  });

  it("rejects when the ticket is not in 'approved' or 'awaiting_payment' status", async () => {
    hasApRole = true;
    existingRow.status = "pending_review";
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ticket.not_approved");
    expect(r.body.error).toBe("ticket_not_approved");
  });

  // Task #595: AP can now disperse funds straight from awaiting_payment
  // without bouncing the ticket back through `approved`. Mirrors the
  // happy-path test below but anchors the source status — the asserted
  // transition row's `fromStatus` must reflect `awaiting_payment` so the
  // status_history audit trail tells the truth about the real movement.
  it("happy path: AP partner can disperse from awaiting_payment, transition records the right fromStatus", async () => {
    hasApRole = true;
    existingRow.status = "awaiting_payment";
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({
        paymentMethod: "etf",
        paymentReference: "TXN-456",
        note: "Customer paid; releasing to vendor",
      });
    expectStatus(r, 200);
    expect(r.body.id).toBe(42);
    expect(r.body.status).toBe("funds_dispersed");

    // Update SET payload still writes the same payment columns.
    const setPayload = updateSetSpy.mock.calls[0]?.[0];
    expect(setPayload.status).toBe("funds_dispersed");
    expect(setPayload.paymentMethod).toBe("etf");
    expect(setPayload.paymentReference).toBe("TXN-456");

    // Audit row anchors on the actual source status, not a hardcoded
    // "approved" — that's the whole point of the Task #595 fix.
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.fromStatus).toBe("awaiting_payment");
    expect(tx.toStatus).toBe("funds_dispersed");
  });

  it("returns 404 when ticket is missing", async () => {
    hasApRole = true;
    existingRow = null;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("ticket.not_found");
    expect(r.body.error).toBe("ticket_not_found");
  });

  it("happy path: AP partner records ETF payment, status flips, vendor is notified", async () => {
    hasApRole = true;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({
        paymentMethod: "etf",
        paymentReference: "TXN-123",
        note: "Wire sent end of day",
      });
    expectStatus(r, 200);
    expect(r.body.id).toBe(42);
    expect(r.body.status).toBe("funds_dispersed");

    // The update SET payload writes all five payment columns + status.
    const setPayload = updateSetSpy.mock.calls[0]?.[0];
    expect(setPayload.status).toBe("funds_dispersed");
    expect(setPayload.paymentMethod).toBe("etf");
    expect(setPayload.paymentReference).toBe("TXN-123");
    expect(setPayload.paymentNote).toBe("Wire sent end of day");
    expect(setPayload.paymentDispersedAt).toBeInstanceOf(Date);
    expect(setPayload.paymentDispersedById).toBe(7);

    // Transition row recorded inside the same transaction.
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.fromStatus).toBe("approved");
    expect(tx.toStatus).toBe("funds_dispersed");
    expect(tx.actorUserId).toBe(7);
    expect(tx.reason).toBe("Wire sent end of day");

    // Vendor users notified.
    expect(findVendorUserIdsMock).toHaveBeenCalledWith(11);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [userIds, notif] = notifyUsersMock.mock.calls[0] as any;
    expect(userIds).toEqual([99, 100]);
    expect(notif.type).toBe("funds_dispersed");
    expect(notif.link).toBe("/tickets/42");
  });

  it("admin can disperse funds even without AP role wiring", async () => {
    hasApRole = false;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", adminCookie)
      .send({ paymentMethod: "other" });
    expectStatus(r, 200);
    expect(r.body.status).toBe("funds_dispersed");
  });

  // Task #852 — optional proof-of-payment receipt. The mobile app
  // posts an `objectPath` from `captureAndUploadImage` and the web
  // app posts the same after its own upload finalize step. The
  // route should persist whatever non-empty trimmed string lands in
  // `paymentReceiptUrl`, and treat blanks/missing as null.
  it("persists paymentReceiptUrl when AP attaches a receipt", async () => {
    hasApRole = true;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({
        paymentMethod: "etf",
        paymentReference: "TXN-789",
        paymentReceiptUrl: "/objects/uploads/abc123",
      });
    expectStatus(r, 200);
    const setPayload = updateSetSpy.mock.calls[0]?.[0];
    expect(setPayload.paymentReceiptUrl).toBe("/objects/uploads/abc123");
  });

  it("nulls paymentReceiptUrl when AP submits an empty/whitespace value", async () => {
    hasApRole = true;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({
        paymentMethod: "etf",
        paymentReceiptUrl: "   ",
      });
    expectStatus(r, 200);
    const setPayload = updateSetSpy.mock.calls[0]?.[0];
    expect(setPayload.paymentReceiptUrl).toBeNull();
  });
});
