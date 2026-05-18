import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Coverage for Task #504 — POST /tickets/:id/reverse-funds-dispersal.
//
// Same chained-mock recipe as tickets-disperse-funds.test.ts. We assert:
//   * unauthenticated callers are rejected
//   * non-admin callers (partner AP, vendor) are rejected (admin-only)
//   * a non-empty `reason` is required (empty + whitespace-only both 400)
//   * only `funds_dispersed` tickets can be reversed (other states 409)
//   * happy path clears the five payment columns, flips status back to
//     `approved`, and records a *separate* `funds_dispersed → approved`
//     transition row whose reason is prefixed `Reversed:` so the audit
//     trail keeps both the dispersal and the reversal as distinct events
//   * the existing /cancel guard for non-reversed `funds_dispersed`
//     tickets still rejects with `ticket_funds_dispersed`

const cookieFor = (s: object) => buildTestCookie(s);

let existingRow: any = null;
let updatedRow: any = null;
let ticketQueryRow: any = null;
let updateSetSpy = vi.fn();
// Default extended-line-items total returned by the canned db.execute
// mock; overridden per-test where the email's amount label matters.
let lineItemsTotal = "1234.56";

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

const findPartnerApContactEmailsMock = vi.fn(async (..._args: unknown[]) => [
  { email: "ap1@partner.example", preferredLocale: "en" as const },
  { email: "ap2@partner.example", preferredLocale: "es" as const },
]);

vi.mock("../lib/ap-role", () => ({
  userHasApRole: vi.fn(async () => true),
  ACCOUNTS_PAYABLE_ROLE: "Accounts Payable",
  findPartnerApContactEmails: findPartnerApContactEmailsMock,
}));

const sendPaymentReversedEmailMock = vi.fn(
  async (..._args: unknown[]) => ({ messageId: "mid_1" }),
);

vi.mock("../lib/sendgrid", () => ({
  sendPaymentReversedEmail: sendPaymentReversedEmailMock,
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
      // Read order in /tickets/:id/reverse-funds-dispersal:
      //   0: pre-check select on tickets+sites (existingRow)
      //   1: post-commit admin user lookup for the reversal email
      //      (returns ticketQueryRow which lacks displayName, so the
      //      handler falls back to the literal "an admin")
      //   2+: post-tx ticketQuery() join (ticketQueryRow)
      const seq = [() => makeChain([existingRow].filter(Boolean))];
      const fn =
        seq[selectStep] ?? (() => makeChain([ticketQueryRow].filter(Boolean)));
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
    // db.execute() is used inside the reversal-email best-effort block to
    // sum ticket_line_items. The handler reads only `.rows[0].total` and
    // tolerates any non-numeric value, so a fixed canned total is safe.
    execute: async (..._args: unknown[]) => ({
      rows: [{ total: lineItemsTotal }],
    }),
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
  existingRow = {
    ticketId: 42,
    partnerId: 5,
    vendorId: 11,
    status: "funds_dispersed",
    // Snapshot fields the reversal email quotes back. The handler
    // reads them BEFORE the update clears the underlying columns.
    paymentMethod: "check",
    paymentReference: "CHK-1042",
    paymentDispersedAt: new Date("2026-04-15T14:30:00Z"),
    vendorName: "Acme Vendors",
    vendorBillingEmail: "billing@acme.example",
    partnerName: "Bigco Partner",
  };
  lineItemsTotal = "1234.56";
  updatedRow = {
    id: 42,
    status: "approved",
    paymentMethod: null,
    paymentReference: null,
    paymentNote: null,
    paymentDispersedAt: null,
    paymentDispersedById: null,
  };
  // Task #882: row shape comes from `makeTicketRow` so a future column
  // addition to `GetTicketResponse` fails the helper's drift guard
  // instead of silently turning the post-tx zod parse into a 500. The
  // helper's defaults already match the shape this test needs (status
  // "approved", null payment block on the post-reversal row), so no
  // explicit overrides are required.
  ticketQueryRow = makeTicketRow();
  updateSetSpy = vi.fn();
  notifyUsersMock.mockClear();
  findVendorUserIdsMock.mockClear();
  findPartnerUserIdsMock.mockClear();
  recordTransitionMock.mockClear();
  findPartnerApContactEmailsMock.mockClear();
  findPartnerApContactEmailsMock.mockResolvedValue([
    { email: "ap1@partner.example", preferredLocale: "en" as const },
    { email: "ap2@partner.example", preferredLocale: "es" as const },
  ]);
  sendPaymentReversedEmailMock.mockClear();
  sendPaymentReversedEmailMock.mockResolvedValue({ messageId: "mid_1" });

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

describe("POST /tickets/:id/reverse-funds-dispersal", () => {
  it("rejects unauthenticated callers", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(401);
  });

  it("rejects partner AP callers (admin-only role guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", partnerCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_admin_only");
    expect(r.body.error).toBe("forbidden_admin_only");
    // No DB write or transition row leaked through.
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("rejects vendor callers (admin-only role guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", vendorCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_admin_only");
    expect(r.body.error).toBe("forbidden_admin_only");
  });

  it("rejects an empty reason (Zod min-length guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_reverse_funds_body");
    expect(r.body.error).toBe("invalid_reverse_funds_body");
  });

  it("rejects a whitespace-only reason (post-trim guard)", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "    " });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.reverse_funds_reason_required");
    expect(r.body.error).toBe("reverse_funds_reason_required");
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing reason field entirely", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_reverse_funds_body");
    expect(r.body.error).toBe("invalid_reverse_funds_body");
  });

  it("returns 404 when the ticket is missing", async () => {
    existingRow = null;
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "wrong vendor" });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("ticket.not_found");
    expect(r.body.error).toBe("ticket_not_found");
  });

  it("rejects when the ticket isn't in 'funds_dispersed' status", async () => {
    existingRow.status = "approved";
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "test" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_not_funds_dispersed");
    expect(r.body.code).toBe("ticket.not_funds_dispersed");
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("happy path: clears payment columns, flips to approved, records a distinct reversal transition, notifies AP and vendor", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
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

    // A *separate* transition row is written — never overwriting the
    // original disperse-funds event. The reason is prefixed `Reversed:`
    // so the audit timeline keeps both events as distinct, attributable
    // history entries (the whole point of the task's "auditable event"
    // requirement).
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.fromStatus).toBe("funds_dispersed");
    expect(tx.toStatus).toBe("approved");
    expect(tx.actorUserId).toBe(1);
    expect(tx.actorRole).toBe("admin");
    expect(tx.reason).toBe("Reversed: Wrong vendor — needs to be re-issued");

    // Both vendor users AND partner AP users get notified, since both
    // sides need to know the payment they were just told about is gone.
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

  // Task #862: an emailed reversal goes to the partner AP distribution
  // AND the vendor billing contact, BCC-style, with the original
  // payment metadata so AP can reconcile from their inbox without
  // having to open the app.
  it("emails the partner AP team and vendor billing contact with the original payment + reversal details", async () => {
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "Wrong vendor — needs to be re-issued" });
    expectStatus(r, 200);

    expect(findPartnerApContactEmailsMock).toHaveBeenCalledWith(5);
    expect(sendPaymentReversedEmailMock).toHaveBeenCalledTimes(1);
    const payload = sendPaymentReversedEmailMock.mock.calls[0]![0] as any;
    expect(payload.apRecipients).toEqual([
      { email: "ap1@partner.example", locale: "en" },
      { email: "ap2@partner.example", locale: "es" },
    ]);
    expect(payload.vendorBillingEmail).toBe("billing@acme.example");
    expect(payload.vendorName).toBe("Acme Vendors");
    expect(payload.partnerName).toBe("Bigco Partner");
    expect(payload.ticketTrackingNumber).toBe("0042");
    expect(payload.ticketDetailUrl).toMatch(/\/tickets\/42$/);
    expect(payload.reason).toBe("Wrong vendor — needs to be re-issued");
    // The handler couldn't resolve a real display name from the canned
    // user-row mock, so it falls back to the literal "an admin" — the
    // important assertion is that *something* attributable is passed.
    expect(typeof payload.reversedByName).toBe("string");
    expect(payload.reversedByName.length).toBeGreaterThan(0);
    expect(payload.reversedAt).toBeInstanceOf(Date);

    // Original payment snapshot is captured BEFORE the columns are
    // cleared so accounting can quote the exact method/reference/amount
    // they posted to their ledger.
    expect(payload.originalPayment.method).toBe("check");
    expect(payload.originalPayment.reference).toBe("CHK-1042");
    expect(payload.originalPayment.amountLabel).toMatch(/1,234\.56/);
    expect(payload.originalPayment.dispersedAt).toBeInstanceOf(Date);
  });

  it("still returns 200 when the reversal email send throws", async () => {
    sendPaymentReversedEmailMock.mockRejectedValueOnce(
      new Error("sendgrid unreachable"),
    );
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "wrong vendor" });
    // The reversal itself committed, so the response must succeed even
    // when SendGrid is down — accounting state is the source of truth
    // and the email is best-effort.
    expectStatus(r, 200);
    expect(r.body.id).toBe(42);
    expect(r.body.status).toBe("approved");
    expect(sendPaymentReversedEmailMock).toHaveBeenCalledTimes(1);
  });

  it("skips the vendor billing email when the vendor row has no contact email", async () => {
    existingRow.vendorBillingEmail = null;
    const r = await request(app)
      .post("/api/tickets/42/reverse-funds-dispersal")
      .set("Cookie", adminCookie)
      .send({ reason: "wrong vendor" });
    expectStatus(r, 200);
    expect(sendPaymentReversedEmailMock).toHaveBeenCalledTimes(1);
    const payload = sendPaymentReversedEmailMock.mock.calls[0]![0] as any;
    expect(payload.vendorBillingEmail).toBeNull();
    // AP recipients are still passed through so the email isn't lost.
    expect(payload.apRecipients).toHaveLength(2);
  });
});

// Companion guard: confirm the cancel endpoint still rejects a
// non-reversed funds_dispersed ticket. Task #504 only loosens the
// terminal state via the dedicated reverse endpoint — the cancel path
// must continue to refuse, otherwise admins could blindly cancel and
// orphan the payment columns again.
describe("POST /tickets/:id/cancel — funds_dispersed guard remains for non-reversed dispersals", () => {
  it("still rejects /cancel on a funds_dispersed ticket with ticket_funds_dispersed", async () => {
    existingRow = {
      id: 42,
      partnerId: 5,
      vendorId: 11,
      status: "funds_dispersed",
      paymentDispersedAt: new Date(),
    };
    const r = await request(app)
      .post("/api/tickets/42/cancel")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_funds_dispersed");
    expect(r.body.code).toBe("ticket.funds_dispersed");
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });
});
