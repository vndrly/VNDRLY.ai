import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #625 / Task #631: regression coverage for the "crew_added" push
// that fires from POST /tickets/:id/crew-roster. The foreman/dispatcher
// flow used to insert into ticket_crew with no notification, leaving
// the new crew member to find out only when the ticket changed state
// or when the unblock fan-out (Task #614) ran. We now fire one
// notifyUsers call per insert with
// `dedupeKey=crew_added:<ticketId>:<employeeId>:<addedAtIso>`.
// Including the row's `addedAt` ISO timestamp ensures a re-add after
// a removal still fires (a fresh row has a fresh addedAt), while a
// duplicate POST that races on the unique active-roster constraint
// gets a 409 before the notify call runs.
//
// What we assert:
//   1. After a successful POST /crew-roster, the added crew member's
//      linked user is notified with type=crew_added, the right link,
//      dedupeKey (including the addedAt ISO suffix) and
//      pushData.ticketId for mobile deep-linking.
//   2. The actor (foreman who added themselves) is NOT notified about
//      their own action.
//   3. A vendor_people row with no linked user account skips cleanly
//      (no push fires; the 201 still returns).
//   4. Conflict (employee already on roster) responds 409 and never
//      fires a notification.
//   5. A re-add after a removal (different `addedAt`) produces a
//      different dedupeKey, so the unique `(user_id, dedupe_key)`
//      index does not collapse the second push.


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
let insertReturning: any[] = [];
let insertShouldThrow: { code?: string } | null = null;

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
        returning: () => {
          if (insertShouldThrow) {
            const err: any = new Error("dup");
            err.code = insertShouldThrow.code;
            return Promise.reject(err);
          }
          return Promise.resolve(insertReturning);
        },
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

const notifyUsersMock = vi.fn(async (..._args: unknown[]) => 1);
vi.mock("./notifications", () => ({
  notifyUsers: (...args: unknown[]) =>
    (notifyUsersMock as unknown as (...a: unknown[]) => Promise<number>)(
      ...args,
    ),
}));

let app: express.Express;

// Select sequence in POST /tickets/:id/crew-roster:
//   (1) ensureCrewMutate → loadTicketForAuth (tickets joined sites)
//   (2) ensureCrewMutate → optional vendor_people lookup for
//       field_employee role (skipped for admin/vendor sessions)
//   (3) loadEmployeeForAuth → vendor_people row for the target employee
//   (4) "already on roster" select → existing active crew row, if any
const ticketRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "in_progress",
  partnerId: 99,
  fieldEmployeeId: null,
};

beforeEach(async () => {
  selectQueue = [];
  insertReturning = [];
  insertShouldThrow = null;
  notifyUsersMock.mockClear();
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

describe("POST /tickets/:id/crew-roster — Task #625 crew_added notification", () => {
  it("notifies the newly added crew member's linked user", async () => {
    const EMP_ID = 555;
    const USER_ID = 4242;
    selectQueue = [
      ticketRow, // ensureCrewMutate.loadTicketForAuth
      // (admin caller skips the field_employee vendor_people lookup)
      // loadEmployeeForAuth row
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "Alex",
        lastName: "Doe",
        userId: USER_ID,
      },
      // existing-active-crew lookup → none
      [],
    ];
    const ADDED_AT = new Date("2026-04-28T15:00:00Z");
    insertReturning = [
      {
        id: 12345,
        ticketId: TICKET_ID,
        employeeId: EMP_ID,
        addedAt: ADDED_AT,
        addedByUserId: 1,
      },
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });

    expectStatus(r, 201);
    expect(r.body.employeeId).toBe(EMP_ID);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const call = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(call[0]).toEqual([USER_ID]);
    const payload = call[1];
    expect(payload.type).toBe("crew_added");
    expect(payload.dedupeKey).toBe(
      `crew_added:${TICKET_ID}:${EMP_ID}:${ADDED_AT.toISOString()}`,
    );
    expect(payload.link).toBe(`/tickets/${TICKET_ID}`);
    expect(payload.pushData).toEqual({
      ticketId: TICKET_ID,
      type: "crew_added",
    });
    expect(typeof payload.title).toBe("string");
    expect(payload.body as string).toContain("VNDRLY-00007777");
  });

  it("uses a different dedupeKey for a re-add after removal so the second push still fires", async () => {
    const EMP_ID = 556;
    const USER_ID = 4243;
    // First add
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "Re",
        lastName: "Add",
        userId: USER_ID,
      },
      [],
    ];
    const FIRST_ADDED_AT = new Date("2026-04-28T15:00:00Z");
    insertReturning = [
      {
        id: 1,
        ticketId: TICKET_ID,
        employeeId: EMP_ID,
        addedAt: FIRST_ADDED_AT,
        addedByUserId: 1,
      },
    ];
    const r1 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });
    expectStatus(r1, 201);

    // Simulate a later re-add (after a removal) — fresh ticketCrew row,
    // fresh addedAt timestamp.
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "25",
        firstName: "Re",
        lastName: "Add",
        userId: USER_ID,
      },
      [],
    ];
    const SECOND_ADDED_AT = new Date("2026-04-28T17:30:00Z");
    insertReturning = [
      {
        id: 2,
        ticketId: TICKET_ID,
        employeeId: EMP_ID,
        addedAt: SECOND_ADDED_AT,
        addedByUserId: 1,
      },
    ];
    const r2 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });
    expectStatus(r2, 201);

    expect(notifyUsersMock).toHaveBeenCalledTimes(2);
    const firstKey = (notifyUsersMock.mock.calls[0]![1] as Record<string, unknown>)
      .dedupeKey as string;
    const secondKey = (notifyUsersMock.mock.calls[1]![1] as Record<string, unknown>)
      .dedupeKey as string;
    expect(firstKey).toBe(
      `crew_added:${TICKET_ID}:${EMP_ID}:${FIRST_ADDED_AT.toISOString()}`,
    );
    expect(secondKey).toBe(
      `crew_added:${TICKET_ID}:${EMP_ID}:${SECOND_ADDED_AT.toISOString()}`,
    );
    expect(firstKey).not.toBe(secondKey);
  });

  it("does NOT notify when the actor adds themselves to the roster", async () => {
    const EMP_ID = 600;
    const USER_ID = 1; // matches admin session userId
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "foreman",
        hourlyRate: "30",
        firstName: "Self",
        lastName: "Adder",
        userId: USER_ID,
      },
      [],
    ];
    insertReturning = [
      {
        id: 99,
        ticketId: TICKET_ID,
        employeeId: EMP_ID,
        addedAt: new Date("2026-04-28T15:00:00Z"),
        addedByUserId: USER_ID,
      },
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });

    expectStatus(r, 201);
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("skips the push when the crew member has no linked user account", async () => {
    const EMP_ID = 777;
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: null,
        firstName: "No",
        lastName: "Login",
        userId: null,
      },
      [],
    ];
    insertReturning = [
      {
        id: 100,
        ticketId: TICKET_ID,
        employeeId: EMP_ID,
        addedAt: new Date("2026-04-28T15:00:00Z"),
        addedByUserId: 1,
      },
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });

    expectStatus(r, 201);
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("returns 409 and does not notify when the employee is already on the active roster", async () => {
    const EMP_ID = 888;
    selectQueue = [
      ticketRow,
      {
        id: EMP_ID,
        vendorId: VENDOR_ID,
        vendorRole: "field",
        hourlyRate: "20",
        firstName: "Already",
        lastName: "Here",
        userId: 9000,
      },
      // existing-active-crew lookup → an active row exists
      [{ id: 42 }],
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/crew-roster`)
      .set("Cookie", adminCookie)
      .send({ employeeId: EMP_ID });

    expect(r.status).toBe(409);
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });
});
