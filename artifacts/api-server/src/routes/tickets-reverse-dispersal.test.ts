import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for Task #853 — POST /tickets/:id/reverse-dispersal.
//
// This is the AP-self-service sibling of the admin-only Task #504
// /reverse-funds-dispersal endpoint (covered separately in
// tickets-reverse-funds-dispersal.test.ts). Same chained-mock recipe.
// We assert:
//   * unauthenticated callers are rejected
//   * non-admin / non-AP callers are rejected (403)
//   * admin callers always pass the role gate
//   * partner-AP callers (correct partner + AP role) pass
//   * a partner caller without the AP role is rejected even on the
//     correct partner
//   * a non-empty `reason` is required (empty + whitespace-only both 400)
//   * only `funds_dispersed` tickets can be reversed (other states 409)
//   * happy path clears the five payment columns, flips status back to
//     `approved`, writes a `payment_audit` snapshot row capturing the
//     pre-reverse payment columns + actor + reason, and records a
//     *separate* `funds_dispersed → approved` transition row whose
//     reason is prefixed `Reversed:` so the audit timeline keeps both
//     events as distinct, attributable history entries.

const cookieFor = (s: object) => buildTestCookie(s);

let existingRow: any = null;
let updatedRow: any = null;
let ticketQueryRow: any = null;
let updateSetSpy = vi.fn();
let paymentAuditInsertSpy = vi.fn();

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

const userHasApRoleMock = vi.fn(async () => true);

vi.mock("../lib/ap-role", () => ({
  userHasApRole: userHasApRoleMock,
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
}));

vi.mock("@workspace/db", () => {
  // Stash the table name on a non-Proxy-intercepted symbol so test code
  // can identify which table an `insert(table)` call targeted (the
  // catch-all `get` handler below otherwise returns column descriptors
  // for every property access, including `__name`).
  const TABLE_NAME = Symbol.for("test.tableName");
  const tableTag = (name: string) =>
    new Proxy(
      { [TABLE_NAME]: name } as Record<PropertyKey, unknown>,
      {
        get: (target, k) =>
          k === TABLE_NAME
            ? (target as Record<PropertyKey, unknown>)[TABLE_NAME]
            : { __table: name, __col: k },
      },
    );
  let selectStep = 0;
  const db: any = {
    select: () => {
      // Read order in /tickets/:id/reverse-dispersal:
      //   0: pre-check select on tickets+sites (existingRow)
      //   1+: post-tx ticketQuery() join (ticketQueryRow)
      const seq = [() => makeChain([existingRow].filter(Boolean))];
      const fn =
        seq[selectStep] ?? (() => makeChain([ticketQueryRow].filter(Boolean)));
      selectStep += 1;
      return fn();
    },
    insert: (table: any) => ({
      values: (vals: any) => {
        // Capture writes to payment_audit so we can assert the snapshot
        // shape on the happy path. Writes to other tables are no-ops.
        if (table?.[TABLE_NAME] === "paymentAudit") {
          paymentAuditInsertSpy(vals);
        }
        return { returning: () => Promise.resolve([]) };
      },
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
    paymentAuditTable: tableTag("paymentAudit"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

const notifyUsersMock = vi.fn(async (..._args: unknown[]) => undefined);
const findVendorUserIdsMock = vi.fn(async () => [99, 100]);
const findPartnerUserIdsMock = vi.fn(async () => [55]);

vi.mock("./notifications", () => ({
  notifyUsers: notifyUsersMock,
  findVendorUserIds: findVendorUserIdsMock,
  findPartnerUserIds: findPartnerUserIdsMock,
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

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

// Partner-AP caller: same partnerId as the existing ticket row + the
// userHasApRoleMock returns true by default.
const partnerApCookie = cookieFor({
  userId: 7,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

// Partner caller WITHOUT AP role — used in the dedicated test that
// sets userHasApRoleMock to false.
const partnerNonApCookie = cookieFor({
  userId: 8,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

const partnerOtherCookie = cookieFor({
  userId: 17,
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
  existingRow = {
    ticketId: 42,
    partnerId: 5,
    vendorId: 11,
    status: "funds_dispersed",
    paymentMethod: "check",
    paymentReference: "CHK-123",
    paymentNote: "Q3 payout",
    paymentDispersedAt: new Date("2025-01-15T10:00:00Z"),
    paymentDispersedById: 12,
  };
  updatedRow = {
    id: 42,
    status: "approved",
    paymentMethod: null,
    paymentReference: null,
    paymentNote: null,
    paymentDispersedAt: null,
    paymentDispersedById: null,
  };
  ticketQueryRow = {
    id: 42,
    siteLocationId: 1,
    vendorId: 11,
    fieldEmployeeId: null,
    workTypeId: 2,
    status: "approved",
    description: null,
    notes: null,
    kickbackReason: null,
    checkInTime: new Date(),
    checkOutTime: null,
    checkInLatitude: null,
    checkInLongitude: null,
    checkOutLatitude: null,
    checkOutLongitude: null,
    siteName: "S",
    vendorName: "V",
    workTypeName: "W",
    fieldEmployeeName: null,
    partnerName: "P",
    partnerLogoUrl: null,
    vendorLogoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    unlockedAt: null,
    unlockedById: null,
    unlockedByName: null,
    unlockCount: 0,
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
    afe: null,
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
    // Task #51 — server-computed unread-comment badge counter.
    unreadCommentCount: 0,
  };
  updateSetSpy = vi.fn();
  paymentAuditInsertSpy = vi.fn();
  notifyUsersMock.mockClear();
  findVendorUserIdsMock.mockClear();
  findPartnerUserIdsMock.mockClear();
  recordTransitionMock.mockClear();
  userHasApRoleMock.mockReset();
  userHasApRoleMock.mockImplementation(async () => true);

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  attachTestErrorMiddleware(app);
  const { db } = await import("@workspace/db");
  (db as any).__resetSelectStep?.();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /tickets/:id/reverse-dispersal", () => {
  it("rejects unauthenticated callers", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(401);
  });

  it("rejects vendor callers (not admin and not partner-AP)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", vendorCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(r.body.error).toBe("forbidden_not_ap");
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
    expect(paymentAuditInsertSpy).not.toHaveBeenCalled();
  });

  it("rejects a partner caller on a different partner", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", partnerOtherCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    // The AP-role helper should never even be consulted when the
    // partner doesn't own the ticket — guard short-circuits earlier.
    expect(userHasApRoleMock).not.toHaveBeenCalled();
  });

  it("rejects a partner caller on the right partner who lacks the AP role", async () => {
    userHasApRoleMock.mockImplementationOnce(async () => false);
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", partnerNonApCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(userHasApRoleMock).toHaveBeenCalledWith(8, 5);
  });

  it("rejects an empty reason (Zod min-length guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_reverse_dispersal_body");
    expect(r.body.error).toBe("invalid_reverse_dispersal_body");
  });

  it("rejects a whitespace-only reason (post-trim guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "    " });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.reverse_dispersal_reason_required");
    expect(r.body.error).toBe("reverse_dispersal_reason_required");
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing reason field entirely", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_reverse_dispersal_body");
    expect(r.body.error).toBe("invalid_reverse_dispersal_body");
  });

  it("returns 404 when the ticket is missing", async () => {
    existingRow = null;
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("ticket.not_found");
    expect(r.body.error).toBe("ticket_not_found");
  });

  it("rejects when the ticket isn't in 'funds_dispersed' status", async () => {
    existingRow.status = "approved";
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "test" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_not_funds_dispersed");
    expect(r.body.code).toBe("ticket.not_funds_dispersed");
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
    expect(paymentAuditInsertSpy).not.toHaveBeenCalled();
  });

  it("admin happy path: clears payment columns, flips to approved, writes a payment_audit snapshot, records a distinct reversal transition, notifies AP and vendor", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "Wrong vendor — needs to be re-issued" });
    expectStatus(r, 200);
    expect(r.body.id).toBe(42);
    expect(r.body.status).toBe("approved");

    // The five payment columns are cleared and status reverts to approved.
    const setPayload = updateSetSpy.mock.calls[0]?.[0];
    expect(setPayload.status).toBe("approved");
    expect(setPayload.paymentMethod).toBeNull();
    expect(setPayload.paymentReference).toBeNull();
    expect(setPayload.paymentNote).toBeNull();
    expect(setPayload.paymentDispersedAt).toBeNull();
    expect(setPayload.paymentDispersedById).toBeNull();

    // payment_audit snapshot captures the pre-clear payment columns,
    // the actor, and the verbatim reason. This is the new contract from
    // Task #853 — the admin endpoint above does not write this row.
    expect(paymentAuditInsertSpy).toHaveBeenCalledTimes(1);
    const snap = paymentAuditInsertSpy.mock.calls[0]?.[0];
    expect(snap.ticketId).toBe(42);
    expect(snap.action).toBe("dispersal_reversed");
    expect(snap.reason).toBe("Wrong vendor — needs to be re-issued");
    expect(snap.actorUserId).toBe(1);
    expect(snap.actorRole).toBe("admin");
    expect(snap.paymentMethodSnapshot).toBe("check");
    expect(snap.paymentReferenceSnapshot).toBe("CHK-123");
    expect(snap.paymentNoteSnapshot).toBe("Q3 payout");
    expect(snap.paymentDispersedAtSnapshot).toEqual(
      new Date("2025-01-15T10:00:00Z"),
    );
    expect(snap.paymentDispersedByIdSnapshot).toBe(12);

    // A *separate* transition row is written — never overwriting the
    // original disperse-funds event. Reason is prefixed `Reversed:`.
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.fromStatus).toBe("funds_dispersed");
    expect(tx.toStatus).toBe("approved");
    expect(tx.actorUserId).toBe(1);
    expect(tx.actorRole).toBe("admin");
    expect(tx.reason).toBe("Reversed: Wrong vendor — needs to be re-issued");

    // Both vendor users AND partner AP users get notified.
    expect(findVendorUserIdsMock).toHaveBeenCalledWith(11);
    expect(findPartnerUserIdsMock).toHaveBeenCalledWith(5);
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);
    const allNotifiedUserIds = notifyUsersMock.mock.calls.flatMap(
      (call) => call[0] as number[],
    );
    expect(allNotifiedUserIds).toEqual(
      expect.arrayContaining([99, 100, 55]),
    );
  });

  it("partner-AP happy path: caller with the AP role on the owning partner can reverse and is recorded as the actor", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-dispersal")
      .set("Cookie", partnerApCookie)
      .send({ reason: "Re-keying with the right reference" });
    expectStatus(r, 200);
    expect(r.body.status).toBe("approved");

    // The AP-role helper was consulted with this caller's userId + the
    // ticket's owning partnerId.
    expect(userHasApRoleMock).toHaveBeenCalledWith(7, 5);

    // payment_audit snapshot attributes the reversal to the partner-AP
    // user (not an admin).
    expect(paymentAuditInsertSpy).toHaveBeenCalledTimes(1);
    const snap = paymentAuditInsertSpy.mock.calls[0]?.[0];
    expect(snap.actorUserId).toBe(7);
    expect(snap.actorRole).toBe("partner");

    // Same actor info on the transition row.
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.actorUserId).toBe(7);
    expect(tx.actorRole).toBe("partner");
    expect(tx.reason).toBe("Reversed: Re-keying with the right reference");
  });
});
