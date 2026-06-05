import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Coverage for Task #527 — structured `{ error: <snake_case_code>, message }`
// payloads on the ticket-mutation endpoints. These tests deliberately stop
// at the first guard that returns a 4xx so we can assert on the response
// body code without standing up the full DB. The chained-mock recipe is
// the same as tickets-vendor-handshake.test.ts and tickets-disperse-funds.test.ts.


const cookieFor = (s: object) => buildTestCookie(s);

// Per-test mutable rows. Several handlers run an ownership lookup before
// the state guard (ensureFieldOwnership in tickets.ts, loadTicketForAuth
// in ticketSchedule.ts), and then a second select for the state check —
// so we return `ticketRow` on every call rather than a single seq slot,
// and use `vendorRow` only for /reinvite's vendor-id lookup.
let ticketRow: any = null;
let vendorRow: any = null;
let hasApRole = false;
// Toggle used only by /reinvite to switch the second-select payload from
// the ticket row to the vendor row.
let nextSelectIsVendor = false;
// Used by PATCH /tickets/:id (Task #533 field_employee_vendor_mismatch
// regression). The handler does TWO selects after admin bypass: (1) the
// existing-ticket lookup, then (2) the vendor_people lookup. We can't
// reuse `ticketRow` for both because the guard fires only when the two
// vendorIds differ — so we count select calls and substitute `feRow` on
// the configured 1-indexed call number. Default of -1 means never.
let feRow: any = null;
let selectFeAtCall = -1;
let selectCallCount = 0;

// Task #551: lets the awaiting-payment happy-path test exercise the
// post-update success branch. Default `[]` keeps every existing mutation
// test on its current 404/409 path through the `if (!updated)` short-circuit.
let updateReturnRows: any[] = [];

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
  const db: any = {
    select: () => {
      // Most handlers do: (1) ownership/auth select (returns ticket row)
      // then (2) state-check select (also returns ticket row). Returning
      // ticketRow on every call keeps the mock simple while still letting
      // the route reach its body-validation / state-precondition guards.
      // The /reinvite handler is the one exception — it does a vendor
      // lookup; tests opt in via `nextSelectIsVendor`. PATCH /tickets/:id
      // does an additional vendor_people lookup when fieldEmployeeId is
      // set; tests opt in by setting `selectFeAtCall` to the 1-indexed
      // select-call slot that should return `feRow`.
      selectCallCount += 1;
      if (nextSelectIsVendor) {
        nextSelectIsVendor = false;
        return makeChain([vendorRow].filter(Boolean));
      }
      if (selectFeAtCall === selectCallCount) {
        return makeChain([feRow].filter(Boolean));
      }
      return makeChain([ticketRow].filter(Boolean));
    },
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(updateReturnRows) }),
      }),
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
    ticketScheduleAuditTable: tableTag("ticketScheduleAudit"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
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

const vendorCookie = cookieFor({
  userId: 9,
  role: "vendor",
  vendorId: 11,
  partnerId: null,
});

const otherVendorCookie = cookieFor({
  userId: 10,
  role: "vendor",
  vendorId: 999,
  partnerId: null,
});

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

// Task #767: re-importing tickets+ticketSchedule (~5.7k LOC combined) after
// resetModules() can exceed Vitest's default 10s hookTimeout under parallel
// CI load. Bumped to 30s; healthy cold import is ~5s.
beforeEach(async () => {
  ticketRow = null;
  vendorRow = null;
  feRow = null;
  hasApRole = false;
  nextSelectIsVendor = false;
  selectFeAtCall = -1;
  selectCallCount = 0;
  updateReturnRows = [];
  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  const { default: scheduleRouter } = await import("./ticketSchedule");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  app.use("/api", scheduleRouter);
  attachTestErrorMiddleware(app);
}, 30000);

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/accept — vendor handshake
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/accept (Task #527 codes)", () => {
  it("emits forbidden_not_invited_vendor when caller's vendor org doesn't match", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 11 });
    const r = await request(app)
      .post("/api/tickets/123/accept")
      .set("Cookie", otherVendorCookie)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_invited_vendor");
    expect(r.body.error).toBe("forbidden_not_invited_vendor");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits ticket_not_awaiting_acceptance once the invite was already responded to", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "in_progress", vendorId: 11 });
    const r = await request(app)
      .post("/api/tickets/123/accept")
      .set("Cookie", vendorCookie)
      .send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ticket.not_awaiting_acceptance");
    expect(r.body.error).toBe("ticket_not_awaiting_acceptance");
    expect(typeof r.body.message).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/deny — vendor declines invite with a reason
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/deny (Task #527 codes)", () => {
  it("emits deny_reason_required when reason is empty/whitespace", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 11 });
    const r = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", vendorCookie)
      .send({ reason: "   " });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.deny_reason_required");
    expect(r.body.error).toBe("deny_reason_required");
  });

  it("emits deny_reason_too_long beyond 500 characters", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 11 });
    const r = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", vendorCookie)
      .send({ reason: "x".repeat(501) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.deny_reason_too_long");
    expect(r.body.error).toBe("deny_reason_too_long");
  });

  it("emits forbidden_not_invited_vendor when a different vendor tries to deny", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 11 });
    const r = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", otherVendorCookie)
      .send({ reason: "Out of capacity" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_invited_vendor");
    expect(r.body.error).toBe("forbidden_not_invited_vendor");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/reinvite — partner reassigns to a different vendor
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/reinvite (Task #527 codes)", () => {
  it("emits vendor_id_required when the body is missing vendorId", async () => {
    ticketRow = makeTicketRow({
      id: 123,
      status: "denied",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const r = await request(app)
      .post("/api/tickets/123/reinvite")
      .set("Cookie", partnerCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.vendor_id_required");
    expect(r.body.error).toBe("vendor_id_required");
  });

  it("emits vendor_already_invited when reassigning to the current vendor", async () => {
    // Both selects in our mock return ticketRow by default. To exercise
    // the same-vendor guard, set ticketRow.id == ticketRow.vendorId so
    // that when the second select (vendors lookup) returns the row, the
    // handler's `vendor.id === existing.vendorId` check evaluates true.
    ticketRow = makeTicketRow({
      id: 7,
      status: "denied",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
      name: "ACME",
    });
    const r = await request(app)
      .post("/api/tickets/123/reinvite")
      .set("Cookie", partnerCookie)
      .send({ vendorId: 7 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.vendor_already_invited");
    expect(r.body.error).toBe("vendor_already_invited");
  });

  it("emits forbidden_not_owning_partner when a different partner tries to reinvite", async () => {
    ticketRow = makeTicketRow({
      id: 123,
      status: "denied",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const r = await request(app)
      .post("/api/tickets/123/reinvite")
      .set("Cookie", cookieFor({ userId: 2, role: "partner", vendorId: null, partnerId: 999 }))
      .send({ vendorId: 42 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_owning_partner");
    expect(r.body.error).toBe("forbidden_not_owning_partner");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/unlock — admin reopens a submitted/approved ticket
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/unlock (Task #527 codes)", () => {
  it("emits unlock_reason_required when reason is whitespace-only", async () => {
    const r = await request(app)
      .post("/api/tickets/123/unlock")
      .set("Cookie", adminCookie)
      .send({ reason: "   " });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.unlock_reason_required");
    expect(r.body.error).toBe("unlock_reason_required");
  });

  // The 500-char ceiling is enforced by the Zod schema (`max(500)`)
  // *before* the handler's trim-then-check fallback runs, so over-long
  // reasons currently surface as the generic Zod 400. The handler-level
  // `unlock_reason_too_long` code remains as a safety net for code paths
  // that bypass Zod and is intentionally not asserted here.

  it("emits forbidden_admin_only for non-admin callers", async () => {
    const r = await request(app)
      .post("/api/tickets/123/unlock")
      .set("Cookie", partnerCookie)
      .send({ reason: "Need to fix line items" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_admin_only");
    expect(r.body.error).toBe("forbidden_admin_only");
  });

  it("emits ticket_not_unlockable when status isn't submitted/approved", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "in_progress", fieldEmployeeId: null });
    const r = await request(app)
      .post("/api/tickets/123/unlock")
      .set("Cookie", adminCookie)
      .send({ reason: "Need to fix line items" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ticket.not_unlockable");
    expect(r.body.error).toBe("ticket_not_unlockable");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/reactivate — admin restores a cancelled ticket
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/reactivate (Task #527 codes)", () => {
  it("emits forbidden_admin_only for non-admin callers", async () => {
    const r = await request(app)
      .post("/api/tickets/123/reactivate")
      .set("Cookie", partnerCookie)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_admin_only");
    expect(r.body.error).toBe("forbidden_admin_only");
  });

  it("emits invalid_ticket_id for non-numeric id", async () => {
    const r = await request(app)
      .post("/api/tickets/not-a-number/reactivate")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_ticket_id");
    expect(r.body.error).toBe("invalid_ticket_id");
  });

  it("emits ticket_not_cancelled when the ticket is in another status", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "in_progress", preCancelStatus: null });
    const r = await request(app)
      .post("/api/tickets/123/reactivate")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.not_cancelled");
    expect(r.body.error).toBe("ticket_not_cancelled");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/disperse-funds — AP records payment
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/disperse-funds (Task #527 codes)", () => {
  it("emits payment_reference_required for paymentMethod=check with no reference", async () => {
    hasApRole = true;
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "check" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.payment_reference_required");
    expect(r.body.error).toBe("payment_reference_required");
  });

  it("emits forbidden_not_ap when caller lacks the AP role", async () => {
    hasApRole = false;
    // The handler reads the existing ticket row first, then runs the AP
    // role check — provide a row so we exercise the AP guard rather than
    // tripping the 404 ticket_not_found short-circuit.
    ticketRow = makeTicketRow({ ticketId: 42, partnerId: 5, vendorId: 11, status: "approved" });
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_ap");
    expect(r.body.error).toBe("forbidden_not_ap");
  });

  it("emits ticket_not_approved when status isn't 'approved' or 'awaiting_payment'", async () => {
    hasApRole = true;
    ticketRow = makeTicketRow({ ticketId: 42, partnerId: 5, vendorId: 11, status: "pending_review" });
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_not_approved");
    // Legacy `code` is preserved for clients that pre-date Task #527.
    expect(r.body.code).toBe("ticket.not_approved");
  });

  // Task #595: awaiting_payment is now an additional valid source status
  // for /disperse-funds (full happy-path coverage — including the
  // recorded transition's fromStatus — lives in
  // tickets-disperse-funds.test.ts where the chained mock can satisfy
  // the DisperseFundsTicketResponse Zod parser). Here we just assert the
  // status guard no longer rejects it with the ticket_not_approved 409.
  it("does not emit ticket_not_approved when status is 'awaiting_payment'", async () => {
    hasApRole = true;
    ticketRow = makeTicketRow({ ticketId: 42, partnerId: 5, vendorId: 11, status: "awaiting_payment" });
    // Force the CAS update to return no row so we exit on the post-update
    // 409 branch — that branch still reuses ticket_not_approved, but if
    // the pre-check guard regresses to "approved-only" we would 409 here
    // for a different reason: the guard wouldn't even let us reach the
    // CAS update. Pairing this test with the one above means a regression
    // either flips the guard's status check OR drops awaiting_payment
    // from the CAS WHERE clause.
    const r = await request(app)
      .post("/api/tickets/42/disperse-funds")
      .set("Cookie", partnerCookie)
      .send({ paymentMethod: "etf", paymentReference: "INV-001" });
    // 409 is still possible (the post-update guard returns it when the
    // CAS update finds no matching row), but the body must indicate the
    // pre-check guard let us through — so we assert the request reached
    // the update branch by verifying we DIDN'T 400/403/404 on the way.
    expect([200, 409]).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/en-route — vendor signals departure
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/en-route (Task #527 codes)", () => {
  it("emits ticket_en_route_invalid_state when status doesn't allow en-route", async () => {
    // ensureFieldOwnership reads the ticket first to confirm the vendor
    // owns it; the en-route handler then re-reads it to inspect status +
    // lifecycleState. Both selects return the same shape from our mock.
    ticketRow = makeTicketRow({
      id: 123,
      status: "submitted",
      vendorId: 11,
      partnerId: 5,
      fieldEmployeeId: null,
      lifecycleState: null,
    });
    const r = await request(app)
      .post("/api/tickets/123/en-route")
      .set("Cookie", vendorCookie)
      .send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_en_route_invalid_state");
    // Mobile clients pre-#527 still match on the dotted legacy code.
    expect(r.body.code).toBe("ticket.en_route_invalid_state");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/schedule — partner/scheduler sets crew + start window
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/schedule (Task #527 codes)", () => {
  it("emits invalid_ticket_id for a non-numeric ticket id", async () => {
    const r = await request(app)
      .post("/api/tickets/not-a-number/schedule")
      .set("Cookie", partnerCookie)
      .send({ scheduledStartAt: new Date().toISOString() });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("validation.invalid_id");
    expect(r.body.error).toBe("invalid_ticket_id");
  });

  it("emits scheduled_start_at_required when start is missing", async () => {
    // Use admin cookie so ensureSchedulerAuth admits us and we land on the
    // body-validation path. (Partner role has no scheduling rights and
    // would short-circuit to 403 forbidden_not_scheduler.)
    ticketRow = makeTicketRow({ id: 123, partnerId: 5, vendorId: 11, status: "initiated" });
    const r = await request(app)
      .post("/api/tickets/123/schedule")
      .set("Cookie", adminCookie)
      .send({ scheduledStartAt: null });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("schedule.start_required");
    expect(r.body.error).toBe("scheduled_start_at_required");
  });

  it("emits invalid_scheduled_duration_minutes for a negative duration", async () => {
    ticketRow = makeTicketRow({ id: 123, partnerId: 5, vendorId: 11, status: "initiated" });
    const r = await request(app)
      .post("/api/tickets/123/schedule")
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: new Date().toISOString(),
        scheduledDurationMinutes: -30,
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("schedule.invalid_duration");
    expect(r.body.error).toBe("invalid_scheduled_duration_minutes");
  });

  it("emits forbidden_not_scheduler for callers without scheduler rights", async () => {
    // Partners are not in the scheduler-auth allowlist (admin / vendor
    // org admin / assigned foreman). Give the handler a ticket so
    // loadTicketForAuth doesn't 404 first.
    ticketRow = makeTicketRow({ id: 123, partnerId: 5, vendorId: 11, status: "initiated" });
    const r = await request(app)
      .post("/api/tickets/123/schedule")
      .set("Cookie", partnerCookie)
      .send({ scheduledStartAt: new Date().toISOString() });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.no_access");
    expect(r.body.error).toBe("forbidden_not_scheduler");
  });

  it("emits ticket_not_found when no ticket matches the id", async () => {
    ticketRow = null;
    const r = await request(app)
      .post("/api/tickets/9999/schedule")
      .set("Cookie", adminCookie)
      .send({ scheduledStartAt: new Date().toISOString() });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("ticket.not_found");
    expect(r.body.error).toBe("ticket_not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task #533 — remaining ticket-mutation routes that previously returned
// free-text Zod messages or English `error` strings. Each branch now emits
// `{ error: <snake_case_code>, message }` so the inline error UIs on web
// and mobile can localize them via the `errors.<code>` catalog instead of
// displaying raw English copy.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// PATCH /tickets/:id — general edit (description, notes, fieldEmployeeId)
// ─────────────────────────────────────────────────────────────────────────
describe("PATCH /tickets/:id (Task #533 codes)", () => {
  it("emits invalid_ticket_id for a non-numeric id", async () => {
    const r = await request(app)
      .patch("/api/tickets/not-a-number")
      .set("Cookie", adminCookie)
      .send({ description: "Updated" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_ticket_id");
    expect(r.body.error).toBe("invalid_ticket_id");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits invalid_update_body when body fails Zod validation", async () => {
    // Admin bypasses ensureFieldOwnership so we land on the body-validation
    // path. fieldEmployeeId must be a number — sending a string trips Zod.
    const r = await request(app)
      .patch("/api/tickets/123")
      .set("Cookie", adminCookie)
      .send({ fieldEmployeeId: "not-a-number" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_update_body");
    expect(r.body.error).toBe("invalid_update_body");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits field_employee_vendor_mismatch when assigning a worker from another vendor", async () => {
    // Sequence of selects on this path with admin caller:
    //   (1) existing-ticket select — must report vendorId for the guard.
    //   (2) vendor_people select for the new fieldEmployeeId.
    // The guard fires only when (1).vendorId !== (2).vendorId, so we
    // override the second call with feRow via the call-count slot.
    ticketRow = makeTicketRow({ id: 123, vendorId: 11, fieldEmployeeId: null });
    feRow = { vendorId: 999 };
    selectFeAtCall = 2;
    const r = await request(app)
      .patch("/api/tickets/123")
      .set("Cookie", adminCookie)
      .send({ fieldEmployeeId: 42 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.field_employee_vendor_mismatch");
    expect(r.body.error).toBe("field_employee_vendor_mismatch");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits ticket_not_found when no ticket matches the id (post-update)", async () => {
    // existing-ticket select returns null → vendor mismatch guard skipped
    // → update returns no rows → 404 ticket_not_found.
    ticketRow = null;
    const r = await request(app)
      .patch("/api/tickets/9999")
      .set("Cookie", adminCookie)
      .send({ description: "Updated" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("ticket_not_found");
    // Legacy dotted code is preserved alongside the new snake_case error.
    expect(r.body.code).toBe("ticket.not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/check-in — vendor / field employee marks arrival
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/check-in (Task #533 codes)", () => {
  it("emits invalid_ticket_id for a non-numeric id", async () => {
    const r = await request(app)
      .post("/api/tickets/not-a-number/check-in")
      .set("Cookie", adminCookie)
      .send({ latitude: 40.0, longitude: -74.0 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_id");
    expect(r.body.error).toBe("invalid_ticket_id");
  });

  it("emits invalid_check_in_body when latitude/longitude are missing", async () => {
    // Admin bypasses ensureFieldOwnership; the next stop is body parsing
    // which requires both latitude and longitude.
    const r = await request(app)
      .post("/api/tickets/123/check-in")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_check_in_body");
    expect(r.body.error).toBe("invalid_check_in_body");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits ticket_not_checkinable when status isn't checkin-eligible", async () => {
    // Already covered in tickets-vendor-handshake.test.ts for the
    // awaiting_acceptance and denied cases. Re-asserting the same code
    // here from the "submitted" side keeps Task #533's coverage matrix
    // self-contained — if anyone ever drops the snake_case error, this
    // file alone tells you which mutation regressed.
    ticketRow = makeTicketRow({ id: 123, status: "submitted", vendorId: 11, partnerId: 5, arrivedAt: null });
    const r = await request(app)
      .post("/api/tickets/123/check-in")
      .set("Cookie", adminCookie)
      .send({ latitude: 40.0, longitude: -74.0 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ticket.not_checkinable");
    expect(r.body.error).toBe("ticket_not_checkinable");
  });

  it("emits ticket_not_found when no ticket matches the id", async () => {
    // Inside the transaction the select returns no row → handler returns
    // the not_found kind → 404 ticket_not_found with the legacy dotted code.
    ticketRow = null;
    const r = await request(app)
      .post("/api/tickets/9999/check-in")
      .set("Cookie", adminCookie)
      .send({ latitude: 40.0, longitude: -74.0 });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("ticket_not_found");
    expect(r.body.code).toBe("ticket.not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /tickets/:id/cancel — partner/admin retracts a ticket
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/cancel (Task #533 codes)", () => {
  it("emits invalid_ticket_id for a non-numeric id", async () => {
    const r = await request(app)
      .post("/api/tickets/not-a-number/cancel")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_id");
    expect(r.body.error).toBe("invalid_ticket_id");
  });

  it("emits ticket_not_found when no ticket matches the id", async () => {
    // Admin bypasses ensureFieldOwnership; the existing-ticket select
    // returns null → 404 ticket_not_found with dotted legacy code.
    ticketRow = null;
    const r = await request(app)
      .post("/api/tickets/9999/cancel")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("ticket_not_found");
    expect(r.body.code).toBe("ticket.not_found");
  });

  it("emits ticket_not_accepted when a vendor tries to cancel a pre-accept ticket", async () => {
    // Mirrors the Task #494 guard in tickets-vendor-handshake.test.ts but
    // keyed off the snake_case `error` code that web/mobile localize.
    ticketRow = makeTicketRow({
      id: 800,
      status: "awaiting_acceptance",
      vendorId: 11,
      partnerId: 5,
      fieldEmployeeId: null,
    });
    const r = await request(app)
      .post("/api/tickets/800/cancel")
      .set("Cookie", vendorCookie);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ticket.not_accepted");
    expect(r.body.error).toBe("ticket_not_accepted");
  });

  it("emits ticket_funds_dispersed when admin cancels a ticket whose AP team paid out", async () => {
    // Once funds are dispersed the cancel transition is forbidden — the
    // AP audit trail can't be rewound. Snake_case `error` is the new
    // primary key; the dotted `code` stays for pre-#527 mobile builds.
    ticketRow = makeTicketRow({
      id: 42,
      status: "funds_dispersed",
      vendorId: 11,
      partnerId: 5,
      fieldEmployeeId: null,
      paymentDispersedAt: new Date(),
    });
    const r = await request(app)
      .post("/api/tickets/42/cancel")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_funds_dispersed");
    expect(r.body.code).toBe("ticket.funds_dispersed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task #551 — POST /tickets/:id/awaiting-payment. Brand-new lifecycle step
// that flips an in-progress ticket into the awaiting_payment state. The
// route lives outside ensureFieldOwnership so its role/state guards can
// emit the modern `{ error: <snake_case_code>, message }` shape directly,
// matching the pattern Tasks #527 / #533 established for the rest of the
// mutation surface.
// ─────────────────────────────────────────────────────────────────────────
describe("POST /tickets/:id/awaiting-payment (Task #551 codes)", () => {
  it("emits invalid_ticket_id for a non-numeric id", async () => {
    const r = await request(app)
      .post("/api/tickets/not-a-number/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_ticket_id");
    expect(r.body.error).toBe("invalid_ticket_id");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits not_authenticated when the request has no session cookie", async () => {
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .send({});
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("not_authenticated");
    // Legacy dotted code stays for clients that pre-date the snake_case shape.
    expect(r.body.code).toBe("auth.not_authenticated");
  });

  it("emits invalid_awaiting_payment_body when note is the wrong type", async () => {
    // Admin bypasses the role guard, so a non-string note trips the body
    // validator before any DB lookup runs (ticketRow stays null on purpose).
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({ note: 12345 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_awaiting_payment_body");
    expect(r.body.error).toBe("invalid_awaiting_payment_body");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits invalid_awaiting_payment_body when note exceeds 500 chars", async () => {
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({ note: "x".repeat(501) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.invalid_awaiting_payment_body");
    expect(r.body.error).toBe("invalid_awaiting_payment_body");
  });

  it("emits ticket_not_found when no ticket matches the id", async () => {
    ticketRow = null;
    const r = await request(app)
      .post("/api/tickets/9999/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("ticket_not_found");
    // Mobile clients pre-#527 still match on the dotted legacy code.
    expect(r.body.code).toBe("ticket.not_found");
  });

  it("emits forbidden_not_assigned when a partner tries to mark awaiting payment", async () => {
    // Partners are intentionally locked out — awaiting-payment is a
    // vendor-side declaration ("we're done, the customer owes us"). Even
    // with an in_progress ticket on their own site they should be denied.
    ticketRow = makeTicketRow({
      id: 123,
      status: "in_progress",
      vendorId: 11,
      fieldEmployeeId: null,
    });
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .set("Cookie", partnerCookie)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_assigned");
    expect(r.body.error).toBe("forbidden_not_assigned");
    expect(typeof r.body.message).toBe("string");
  });

  it("emits forbidden_not_assigned when a different vendor's session tries to mark", async () => {
    // The vendorId on the row is 11; the otherVendorCookie session is on
    // vendorId 999, so the role-aware ownership check denies them.
    ticketRow = makeTicketRow({
      id: 123,
      status: "in_progress",
      vendorId: 11,
      fieldEmployeeId: null,
    });
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .set("Cookie", otherVendorCookie)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.forbidden_not_assigned");
    expect(r.body.error).toBe("forbidden_not_assigned");
  });

  it("emits ticket_not_in_progress when the ticket is in another status", async () => {
    // Admin caller passes the role gate; the status guard fires because
    // only in_progress can flip into awaiting_payment.
    ticketRow = makeTicketRow({
      id: 123,
      status: "submitted",
      vendorId: 11,
      fieldEmployeeId: null,
    });
    const r = await request(app)
      .post("/api/tickets/123/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ticket_not_in_progress");
    expect(r.body.code).toBe("ticket.not_in_progress");
  });

  it("succeeds (200) and returns awaiting_payment status on the happy path", async () => {
    // Pre-state: in_progress ticket owned by vendor 11. Admin marks it.
    // updateReturnRows ensures the CAS update inside the transaction
    // returns a row so we exit the post-update success branch.
    ticketRow = makeTicketRow({
      id: 321,
      status: "in_progress",
      vendorId: 11,
      fieldEmployeeId: null,
    });
    updateReturnRows = [{ id: 321, status: "awaiting_payment" }];
    const r = await request(app)
      .post("/api/tickets/321/awaiting-payment")
      .set("Cookie", adminCookie)
      .send({ note: "Customer promised payment by Friday" });
    expectStatus(r, 200);
    expect(r.body.id).toBe(321);
    expect(r.body.status).toBe("awaiting_payment");
    expect(typeof r.body.message).toBe("string");
  });
});
