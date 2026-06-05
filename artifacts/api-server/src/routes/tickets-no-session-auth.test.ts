import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware } from "../test-utils/route-app";

// Task #41 — Lock in the contract that EVERY ticket mutation endpoint
// rejects a request that arrives with no session cookie at all. The
// historical bug (pre `d42fbbef` / `9e19b475`) was that
// `ensureFieldOwnership` short-circuited to `return true` when the
// caller had no session unless they were a field employee — meaning
// admin/partner/vendor mutation routes that delegated to it would
// happily run for an anonymous request as long as the front-end never
// stripped the cookie. This file makes that regression test-detectable:
// if anyone ever re-introduces the bug (in `ensureFieldOwnership` itself
// OR by adding a new route that forgets the session check), at least one
// case below will flip from a 4xx to a 2xx and the suite will fail.
//
// Why "rejects" instead of "returns 401": most routes return 401 with
// `auth.required` (via `ensureFieldOwnership`) or `auth.not_authenticated`
// (inline checks). The admin-only `/reactivate` route collapses
// "no-session" into its existing 403 `forbidden_admin_only` shape — that
// is also a rejection, and changing its status code now would break
// clients that key off the existing 403 contract. The assertion below
// accepts either status, but additionally asserts the response body
// carries an auth/forbidden code and never indicates a successful state
// mutation.

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  // The whole point of this suite is that no DB call should ever run —
  // a successful auth gate aborts BEFORE reaching the data layer.
  // If a route ever calls into one of these stubs, the test will throw
  // with "session-gate-bypassed" so the failure clearly signals what
  // went wrong instead of crashing on a missing DB.
  const sessionBypassError = (op: string) =>
    new Error(
      `session-gate-bypassed: route reached db.${op}() without a session cookie`,
    );
  const db: any = {
    select: () => {
      throw sessionBypassError("select");
    },
    insert: () => {
      throw sessionBypassError("insert");
    },
    update: () => {
      throw sessionBypassError("update");
    },
    delete: () => {
      throw sessionBypassError("delete");
    },
    transaction: async () => {
      throw sessionBypassError("transaction");
    },
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
    paymentAuditTable: tableTag("paymentAudit"),
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
  aggregateVendorTransitions: vi.fn(async () => []),
  aggregatePartnerTransitions: vi.fn(async () => []),
  aggregateAdminReassignments: vi.fn(async () => []),
}));
vi.mock("../lib/sendgrid", () => ({
  sendPaymentReversedEmail: vi.fn(async () => undefined),
}));
vi.mock("../lib/tickets-rate-limit", () => ({
  enforceTicketsRateLimit: vi.fn(async () => true),
}));

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  attachTestErrorMiddleware(app, { logErrors: false });
}, 30000);

interface MutationCase {
  method: "post" | "patch" | "delete";
  path: string;
  body?: Record<string, unknown>;
}

// One entry per ticket-mutation endpoint defined in `routes/tickets.ts`.
// Keep this list in sync with the Task #500 / #846 endpoint table at the
// top of `tickets.ts`. If you add a new mutation route, add a row here
// so the no-session contract is asserted from day one.
const MUTATION_ROUTES: MutationCase[] = [
  // Create + edit
  { method: "post", path: "/api/tickets", body: { siteLocationId: 1, vendorId: 1, workTypeId: 1 } },
  { method: "patch", path: "/api/tickets/123", body: { description: "x" } },

  // Field-work lifecycle
  { method: "post", path: "/api/tickets/123/check-in", body: {} },
  { method: "post", path: "/api/tickets/123/en-route", body: {} },
  { method: "post", path: "/api/tickets/123/check-out", body: {} },
  { method: "post", path: "/api/tickets/123/submit", body: {} },
  { method: "post", path: "/api/tickets/123/kickback", body: { reason: "x" } },

  // Partner→vendor handshake
  { method: "post", path: "/api/tickets/123/accept", body: {} },
  { method: "post", path: "/api/tickets/123/deny", body: { reason: "x" } },
  { method: "post", path: "/api/tickets/123/reinvite", body: { vendorId: 7 } },

  // Approval + payments
  { method: "post", path: "/api/tickets/123/approve", body: {} },
  { method: "post", path: "/api/tickets/123/disperse-funds", body: { paymentMethod: "check", paymentReference: "001" } },
  { method: "post", path: "/api/tickets/123/awaiting-payment", body: {} },
  { method: "post", path: "/api/tickets/123/reverse-funds-dispersal", body: { reason: "x" } },
  { method: "post", path: "/api/tickets/123/reverse-dispersal", body: { reason: "x" } },

  // Admin/ops
  { method: "post", path: "/api/tickets/123/unlock", body: { reason: "x" } },
  { method: "post", path: "/api/tickets/123/cancel", body: {} },
  { method: "post", path: "/api/tickets/123/reactivate", body: {} },

  // Direct-award (alternative ticket-creation entry point)
  { method: "post", path: "/api/tickets/direct-award", body: { vendorId: 1, hotlistJobId: 1 } },

  // Per-ticket notes + line items
  { method: "post", path: "/api/tickets/123/note-logs", body: { content: "x" } },
  { method: "delete", path: "/api/tickets/123/note-logs/9", body: undefined },
  { method: "post", path: "/api/tickets/123/line-items", body: { description: "x", quantity: 1, unitPrice: 1 } },
  { method: "delete", path: "/api/tickets/123/line-items/9", body: undefined },
];

// Codes the route layer is allowed to emit for a no-session caller. A
// mutation endpoint MUST land on one of these — anything else means the
// route either let the request through (the bug we are guarding against)
// or invented a brand-new error shape that the front-ends do not handle.
const ACCEPTABLE_AUTH_CODES: ReadonlySet<string> = new Set([
  "auth.required", // ensureFieldOwnership
  "auth.not_authenticated", // inline checks (approve, disperse-funds, …)
  "ticket.forbidden_admin_only", // /reactivate collapses no-session into 403
]);

describe("ticket mutation endpoints — no session cookie (Task #41)", () => {
  for (const route of MUTATION_ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path} rejects an anonymous request`, async () => {
      const req = request(app)[route.method](route.path);
      const r = route.body !== undefined ? await req.send(route.body) : await req.send();

      // Reject = 401 for the auth-aware routes; /reactivate is the one
      // legacy holdout that returns 403 because it pre-screens for admin
      // before splitting out an auth-only branch. Both are rejections —
      // what matters is that the request never reached the DB layer
      // (the mocked db.* throws if it does, which would surface as a
      // 500 with the explicit "session-gate-bypassed" message via
      // `attachTestErrorMiddleware`).
      expect(
        r.status,
        `expected ${route.method.toUpperCase()} ${route.path} to reject anonymous request, got ${r.status}: ${JSON.stringify(r.body)}`,
      ).toBeGreaterThanOrEqual(401);
      expect(r.status).toBeLessThan(500);

      const code = (r.body && typeof r.body === "object" && "code" in r.body)
        ? String((r.body as { code: unknown }).code)
        : "";
      expect(
        ACCEPTABLE_AUTH_CODES.has(code),
        `unexpected auth-failure code "${code}" for ${route.method.toUpperCase()} ${route.path}; full body: ${JSON.stringify(r.body)}`,
      ).toBe(true);
    });
  }

  it("ensureFieldOwnership rejects anonymous callers before any DB read (no session-bypass)", async () => {
    // PATCH /tickets/:id is the canonical ensureFieldOwnership-only
    // endpoint that did not exist in d42fbbef but matches its contract.
    // If `ensureFieldOwnership` ever regresses to the pre-d42fbbef
    // `if (!session || session.role !== "field_employee") return true`
    // shape, the mocked `db.select()` will throw and this assertion will
    // flip from 401 to a 500 carrying "session-gate-bypassed".
    const r = await request(app).patch("/api/tickets/123").send({ description: "x" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("auth.required");
    expect(r.body.message).toBe("Authentication required");
  });
});
