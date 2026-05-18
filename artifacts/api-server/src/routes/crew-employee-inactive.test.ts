import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #524: regression coverage for the server-side guard that refuses
// to start a brand-new check-in session OR add a new vendor_people row
// to the ticket roster when the office has just deactivated the worker.
// Both routes must respond 409 with `code: "crew.employee_inactive"` so
// the mobile foreman view (CrewTimeSection) can pin the localized
// `errors.crew.employee_inactive` message under the row instead of
// surfacing a generic toast or a silent server rejection.
//
// The check-out path is intentionally NOT gated, so a worker who was
// already on the clock at the moment of deactivation can still be
// cleanly closed out — that's covered by the existing crew tests.

const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 7777;
const VENDOR_ID = 11;

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

let selectQueue: any[] = [];

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

vi.mock("../lib/logger", () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
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
      const rows = head == null ? [] : Array.isArray(head) ? head : [head];
      return makeChain(rows);
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
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
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketLineItemsTable: tableTag("ticketLineItems"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    ticketAssignmentRatesTable: tableTag("ticketAssignmentRates"),
    ticketCrewTable: tableTag("ticketCrew"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("@workspace/db/format", () => ({
  formatTicketTrackingNumber: (id: number) =>
    `VNDRLY-${String(id).padStart(8, "0")}`,
}));

// Stub the notify side-effect — these routes should never reach it on
// the inactive path, but the route module imports it eagerly.
vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => 0),
}));

let app: express.Express;

const ticketRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "in_progress",
  partnerId: 99,
  fieldEmployeeId: null,
};

beforeEach(async () => {
  selectQueue = [];
  vi.resetModules();
  const router = (await import("./crew")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Task #524 — server refuses crew actions on a deactivated worker", () => {
  it("POST /tickets/:id/crew/:employeeId/check-in responds 409 crew.employee_inactive when vendor_people.is_active is false", async () => {
    const EMP_ID = 555;
    selectQueue = [
      // ensureCrewMutate.loadTicketForAuth
      ticketRow,
      // loadEmployeeForAuth — worker was deactivated mid-shift
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "De",
        lastName: "Activated",
        userId: null,
        isActive: false,
      },
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew/${EMP_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({});

    expect(r.status).toBe(409);
    expect(r.body.code).toBe("crew.employee_inactive");
    expect(typeof r.body.error).toBe("string");
  });

  it("POST /tickets/:id/crew-roster responds 409 crew.employee_inactive when adding a deactivated worker", async () => {
    const EMP_ID = 556;
    selectQueue = [
      // ensureCrewMutate.loadTicketForAuth
      ticketRow,
      // loadEmployeeForAuth — worker was deactivated mid-shift
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "Just",
        lastName: "Deactivated",
        userId: null,
        isActive: false,
      },
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe("crew.employee_inactive");
    expect(typeof r.body.error).toBe("string");
  });

  it("check-in still succeeds (or proceeds past the inactive guard) when isActive is true", async () => {
    // Belt-and-braces: confirm the new guard does NOT regress active
    // workers. The route may still 409 on a duplicate open session for
    // its own reasons, but it must NOT use the crew.employee_inactive
    // code for an active worker.
    const EMP_ID = 557;
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "Still",
        lastName: "Active",
        userId: null,
        isActive: true,
      },
      // open-session lookup → none
      [],
      // ticket-assignment override lookup → none
      [],
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew/${EMP_ID}/check-in`)
      .set("Cookie", adminCookie)
      .send({});

    // We don't assert a specific success status (the chained mock
    // returns no insert rows so the route may end up in a 500 path) —
    // we only assert the new guard didn't fire for an active worker.
    expect(r.body.code).not.toBe("crew.employee_inactive");
  });
});
