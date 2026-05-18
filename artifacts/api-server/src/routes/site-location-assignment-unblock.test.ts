import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #592 + #614: regression coverage for the "ticket unblocked" push
// that fires from POST /site-locations/:siteId/assignments. Task #572
// added a "your ticket is blocked" banner the field worker sees when
// their vendor's site/work-type assignment is missing; until now the
// only way the worker could find out the office had restored the
// assignment was to manually pull-to-refresh. We push them a
// notification the moment the office re-creates the assignment row so
// they can resume.
//
// Task #614 extends the fan-out from "the lead (`fieldEmployeeId`)" to
// every active row in `ticket_crew` for the affected ticket. Crew
// members see the same banner and were silently stuck before.
//
// What we assert:
//   1. After the assignment insert succeeds, every field worker on an
//      open ticket matching (vendor, site, work_type) is notified via
//      `notifyUsers` with `dedupeKey="ticket_unblocked:<ticketId>"` and
//      a `pushData.ticketId` so the mobile deep-link routes correctly.
//   2. Tickets in terminal states (cancelled, paid, …) do NOT trigger
//      a push — they are not "open" any more.
//   3. Tickets whose lead has no linked user account still notify any
//      crew that do, and skip cleanly otherwise.
//   4. The endpoint still responds 201 with the assignment row even
//      when the fan-out is in flight (it's fire-and-forget).
//   5. Crew members on an open ticket also get the push, the lead is
//      not double-notified if also listed in crew, and each (worker,
//      ticket) pair fires exactly one notification.
//
// The DB layer is mocked with a per-test queue of select results,
// mirroring the recipe used by tickets-state-change-assignment.test.ts.


const cookieFor = (s: object) => buildTestCookie(s);

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const partnerNonAdminCookie = cookieFor({
  userId: 2,
  role: "partner",
  vendorId: null,
  partnerId: 99,
  // missing membershipRole=admin → POST should be rejected before insert
});

let selectQueue: any[] = [];
let insertReturning: any[] = [];

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
        returning: () => Promise.resolve(insertReturning),
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertReturning),
        }),
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
    siteLocationsTable: tableTag("siteLocations"),
    partnersTable: tableTag("partners"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    workTypesTable: tableTag("workTypes"),
    vendorsTable: tableTag("vendors"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketsTable: tableTag("tickets"),
    siteLocationAdminAuditLogTable: tableTag("siteLocationAdminAuditLog"),
    ticketCrewTable: tableTag("ticketCrew"),
    // Task #727: the POST handler now verifies the (vendor, work_type)
    // pair exists in the vendor catalog before inserting the assignment.
    // The unit test feeds a satisfying row via `selectQueue` (see below).
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
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

const notifyUsersMock = vi.fn(async () => 1);
vi.mock("./notifications", () => ({
  notifyUsers: (...args: unknown[]) =>
    (notifyUsersMock as unknown as (...a: unknown[]) => Promise<number>)(
      ...args,
    ),
}));

// Task #622: ticket-events SSE side-channel. The unblock fan-out also
// publishes one event per affected ticket so any open web ticket-detail
// tab can re-fetch and dismiss the assignment-removed banner instantly.
// We mock the publish to keep the unit test pg-free and assert the
// payload shape directly.
const publishTicketUnblockedMock = vi.fn();
vi.mock("../lib/ticket-events", () => ({
  publishTicketUnblocked: (...args: unknown[]) =>
    publishTicketUnblockedMock(...args),
}));

let app: express.Express;

const SITE_ID = 50;
const VENDOR_ID = 11;
const WORK_TYPE_ID = 60;
const ASSIGNMENT_ID = 700;

// Rows the POST handler reads in order. The select sequence in
// `routes/siteLocations.ts` POST `/site-locations/:siteId/assignments`:
//   (1) verifySitePartnerAccess → siteLocations row (admin skips this)
//   (2) Task #727 vendor catalog check → vendor_work_types row
//   (3) post-insert select with joined work_type/vendor → assignment row
//   (4) notifyWorkersOfUnblockedTickets → tickets joined with site_locations
//   (5) (only when 4 returned rows) ticket_crew rows for those tickets
//   (6) (only when 4 returned rows) vendorPeople rows for the union of
//       lead `fieldEmployeeId` and crew `employeeId`
const catalogRow = { id: 9001 };
const insertedAssignmentRow = {
  id: ASSIGNMENT_ID,
  siteLocationId: SITE_ID,
  workTypeId: WORK_TYPE_ID,
  vendorId: VENDOR_ID,
  afe: null,
};
const enrichedAssignmentRow = {
  ...insertedAssignmentRow,
  workTypeName: "Hot Oil",
  workTypeCategory: "field",
  vendorName: "Roughneck Co",
};

beforeEach(async () => {
  selectQueue = [];
  insertReturning = [insertedAssignmentRow];
  notifyUsersMock.mockClear();
  publishTicketUnblockedMock.mockClear();
  vi.resetModules();
  const router = (await import("./siteLocations")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Wait for the fire-and-forget `void notifyWorkersOfUnblockedTickets(...)`
// to flush. setImmediate ensures all microtasks (and the awaited
// notifyUsers call inside) run before we assert.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("POST /site-locations/:siteId/assignments — Task #592 unblock notification", () => {
  it("notifies the field worker on an open ticket affected by the new assignment", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      // affected tickets join (one in_progress ticket assigned to FE 555).
      // `sitePartnerId` is included for the Task #622 SSE side-channel —
      // the publish below uses it to role-scope the unblock event to the
      // owning partner without an extra DB hit per subscriber.
      [
        {
          ticketId: 7777,
          fieldEmployeeId: 555,
          siteName: "Well Pad 12",
          sitePartnerId: 99,
        },
      ],
      // ticket_crew lookup for the affected tickets — none in this case
      [],
      // vendor_people lookup → maps fieldEmployeeId 555 → userId 4242
      [{ id: 555, userId: 4242 }],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    expect(r.body.id).toBe(ASSIGNMENT_ID);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const call = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    const recipients = call[0];
    const payload = call[1];
    expect(recipients).toEqual([4242]);
    expect(payload.type).toBe("ticket_unblocked");
    expect(payload.dedupeKey).toBe("ticket_unblocked:7777");
    expect(payload.link).toBe("/tickets/7777");
    expect(payload.pushData).toEqual({
      ticketId: 7777,
      type: "ticket_unblocked",
    });
    expect(typeof payload.title).toBe("string");
    expect(typeof payload.body).toBe("string");
    expect(payload.body as string).toContain("VNDRLY-00007777");
    expect(payload.body as string).toContain("Well Pad 12");
    // Task #622: SSE side-channel publish runs once per affected ticket
    // alongside the push fan-out. Web ticket-detail tabs subscribe to
    // `/api/tickets/events`, filter by ticketId, and re-fetch — the
    // assignment-removed banner clears the same instant the office
    // restored the assignment, no 7-second poll wait.
    expect(publishTicketUnblockedMock).toHaveBeenCalledTimes(1);
    expect(publishTicketUnblockedMock).toHaveBeenCalledWith({
      ticketId: 7777,
      vendorId: VENDOR_ID,
      partnerId: 99,
    });
  });

  it("does not notify when no open tickets match (vendor, site, work_type)", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      // no affected tickets → fan-out short-circuits
      [],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    await flushAsync();
    expect(notifyUsersMock).not.toHaveBeenCalled();
    // Task #622: nothing to publish either when no tickets were affected.
    expect(publishTicketUnblockedMock).not.toHaveBeenCalled();
  });

  it("skips tickets whose field employee has no linked user account", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      [
        {
          ticketId: 8888,
          fieldEmployeeId: 666,
          siteName: "Pad A",
          sitePartnerId: 99,
        },
      ],
      // ticket_crew lookup → no crew on this ticket
      [],
      // vendor_people row exists but userId is null (e.g. detached login)
      [{ id: 666, userId: null }],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).not.toHaveBeenCalled();
    // Task #622: even with zero push recipients, the SSE side-channel
    // MUST still fire — a vendor-office user with this ticket open in
    // the browser has no push to fall back on, and the whole point of
    // the channel is to let the web auto-clear the assignment-removed
    // banner without waiting on the 7s poll. Gating publish behind the
    // mobile fan-out (the old shape of this code) silently broke web
    // auto-clear in exactly this scenario — detached lead, no crew —
    // which is the most common "no recipients" failure mode.
    expect(publishTicketUnblockedMock).toHaveBeenCalledTimes(1);
    expect(publishTicketUnblockedMock).toHaveBeenCalledWith({
      ticketId: 8888,
      vendorId: VENDOR_ID,
      partnerId: 99,
    });
  });

  it("rejects partner non-admin callers before any notification fires", async () => {
    // verifySitePartnerAccess returns 403 before reaching the insert,
    // so the queue should never be drained and no fan-out should run.
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", partnerNonAdminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("auth.partner_admin_required");
    await flushAsync();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("notifies multiple workers when several tickets are unblocked at once", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      [
        { ticketId: 1001, fieldEmployeeId: 11, siteName: "Pad A" },
        { ticketId: 1002, fieldEmployeeId: 22, siteName: "Pad A" },
        { ticketId: 1003, fieldEmployeeId: 11, siteName: "Pad A" },
      ],
      // ticket_crew lookup → no crew on these tickets
      [],
      [
        { id: 11, userId: 100 },
        { id: 22, userId: 200 },
      ],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).toHaveBeenCalledTimes(3);
    const dedupeKeys = (notifyUsersMock.mock.calls as unknown as [
      number[],
      { dedupeKey: string },
    ][]).map((c) => c[1].dedupeKey);
    // Each ticket gets its own dedupe key — same worker on two tickets
    // (FE 11 → tickets 1001 and 1003) gets two distinct notifications,
    // but a future re-trigger for ticket 1001 will dedupe to zero on
    // the unique (user_id, dedupe_key) index.
    expect(new Set(dedupeKeys)).toEqual(
      new Set([
        "ticket_unblocked:1001",
        "ticket_unblocked:1002",
        "ticket_unblocked:1003",
      ]),
    );
  });

  // Task #614: crew members get the same push as the lead.
  it("notifies crew members in addition to the lead, without double-firing for overlap", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      // One open ticket with lead = vendor_people 11.
      [{ ticketId: 5000, fieldEmployeeId: 11, siteName: "Pad B" }],
      // Active crew on that ticket: 22 and 33. 11 also appears in crew
      // (foreman flow lets the lead be "on the crew" too) — must not
      // fire twice.
      [
        { ticketId: 5000, employeeId: 11 },
        { ticketId: 5000, employeeId: 22 },
        { ticketId: 5000, employeeId: 33 },
      ],
      // vendor_people lookup for the union {11, 22, 33}
      [
        { id: 11, userId: 100 },
        { id: 22, userId: 200 },
        { id: 33, userId: 300 },
      ],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    await flushAsync();
    await flushAsync();
    // Three distinct users for one ticket → exactly three pushes.
    expect(notifyUsersMock).toHaveBeenCalledTimes(3);
    const calls = notifyUsersMock.mock.calls as unknown as [
      number[],
      { dedupeKey: string; pushData: Record<string, unknown> },
    ][];
    const recipientUserIds = calls.map((c) => c[0][0]).sort();
    expect(recipientUserIds).toEqual([100, 200, 300]);
    // Every push targets ticket 5000 with the same dedupe key, so a
    // future re-trigger collapses to zero per user via the unique index.
    for (const [, payload] of calls) {
      expect(payload.dedupeKey).toBe("ticket_unblocked:5000");
      expect(payload.pushData).toEqual({
        ticketId: 5000,
        type: "ticket_unblocked",
      });
    }
  });

  // Task #614: a ticket with crew but no lead (`fieldEmployeeId` null)
  // still notifies the crew. Previously the helper short-circuited on
  // `IS NOT NULL fieldEmployeeId` and dropped the ticket entirely.
  it("notifies crew on an open ticket that has no lead assigned", async () => {
    selectQueue = [
      catalogRow,
      enrichedAssignmentRow,
      [{ ticketId: 6000, fieldEmployeeId: null, siteName: "Pad C" }],
      [
        { ticketId: 6000, employeeId: 44 },
        { ticketId: 6000, employeeId: 55 },
      ],
      [
        { id: 44, userId: 400 },
        { id: 55, userId: 500 },
      ],
    ];
    const r = await request(app)
      .post(`/api/site-locations/${SITE_ID}/assignments`)
      .set("Cookie", adminCookie)
      .send({ vendorId: VENDOR_ID, workTypeId: WORK_TYPE_ID });
    expectStatus(r, 201);
    await flushAsync();
    await flushAsync();
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);
    const recipientUserIds = (notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][])
      .map((c) => c[0][0])
      .sort();
    expect(recipientUserIds).toEqual([400, 500]);
  });
});
