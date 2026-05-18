import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #636 / Task #642: regression coverage for the persistent
// `crew_added` fan-out that fires from POST /tickets/:id/schedule.
// Task #625 wired this route to mirror what POST /tickets/:id/crew-roster
// does — write one notifyUsers row per newly-added crew member so the
// inbox/badge surfaces the assignment. Task #642 then aligned the
// dedupe key shape with crew.ts (Task #631): the key now embeds the
// new ticket_crew row's `addedAt` ISO timestamp, so re-scheduling
// the same person — which soft-removes and re-inserts the row inside
// the route's transaction — fires a fresh push instead of silently
// collapsing on the unique `(user_id, dedupe_key)` index.
//
// Without these tests, a future refactor of the transaction, the
// `.returning()` capture of new ticket_crew rows, or the in-memory
// `ticket_scheduled` push could silently drop the persistent row or
// re-introduce the legacy `crew_added:<ticketId>:<employeeId>` key
// and no one would notice until field workers stopped seeing inbox
// items for re-scheduled tickets.
//
// What we assert:
//   1. After a successful POST /schedule, every crew member with a
//      linked user receives exactly one notifyUsers call with
//      type=crew_added, the right link, pushData.ticketId, and a
//      dedupeKey of the form
//      `crew_added:<ticketId>:<employeeId>:<addedAtIso>`.
//   2. The actor (foreman who schedules themselves into the crew) is
//      NOT notified about their own action.
//   3. A vendor_people row whose userId is null is skipped cleanly
//      (no push fires; the 200 still returns).
//   4. Re-scheduling with the same crew (which produces fresh
//      ticket_crew rows with fresh `addedAt` timestamps) yields a
//      DIFFERENT dedupeKey for the same (ticketId, employeeId), so
//      the unique `(user_id, dedupe_key)` index does not collapse the
//      second push and the worker is told about the re-schedule.


const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 7777;
const VENDOR_ID = 11;
const ADMIN_USER_ID = 1;

const adminCookie = cookieFor({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

let selectQueue: any[] = [];
// Queue of rows the next `.insert(...).values(...).returning()` call
// will resolve with. Only the ticket_crew insert in POST /schedule
// uses `.returning()`; the scheduled-notifications insert does not,
// so it never consumes from this queue.
let insertReturningQueue: any[][] = [];

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
      values: () => {
        const next: any = {
          returning: () => {
            const rows = insertReturningQueue.shift() ?? [];
            return Promise.resolve(rows);
          },
          // The route awaits the bare `.values(...)` for the
          // scheduled-notifications insert (no `.returning()` call).
          then: (resolve: any) => Promise.resolve(undefined).then(resolve),
        };
        return next;
      },
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
    ticketCrewTable: tableTag("ticketCrew"),
    ticketScheduledNotificationsTable: tableTag("ticketScheduledNotifications"),
    vendorPeopleTable: tableTag("vendorPeople"),
    siteLocationsTable: tableTag("siteLocations"),
    partnersTable: tableTag("partners"),
    workTypesTable: tableTag("workTypes"),
    vendorsTable: tableTag("vendors"),
    usersTable: tableTag("users"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    employeeCertificationsTable: tableTag("employeeCertifications"),
    gpsLogsTable: tableTag("gpsLogs"),
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

const sendPushToUserMock = vi.fn(async () => undefined);
vi.mock("../lib/expo-push", () => ({
  sendPushToUser: (...args: unknown[]) =>
    (sendPushToUserMock as unknown as (...a: unknown[]) => Promise<void>)(
      ...args,
    ),
}));

const notifyUsersMock = vi.fn(async () => 1);
vi.mock("./notifications", () => ({
  notifyUsers: (...args: unknown[]) =>
    (notifyUsersMock as unknown as (...a: unknown[]) => Promise<number>)(
      ...args,
    ),
}));

let app: express.Express;

// Select sequence in POST /tickets/:id/schedule for an admin caller
// (admin short-circuits the vendor org-membership / foreman lookups):
//   (1) ensureSchedulerAuth → loadTicketForAuth (tickets joined sites)
//   (2) crew validation lookup → vendor_people rows for crewEmployeeIds
//   (3) ticket details → tickets row (id, vendorId, siteLocationId, workTypeId)
//   (4) site row → name, address, partnerId
//   (5) work_type row → name, requiredCertifications
//   (6) partner row → name (only if site row was returned)
//   (7) conflict-detection join (only when crew length > 0 and !force)
//   (— cert warnings query is skipped when requiredCertifications is empty)
const ticketRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "scheduled",
  siteLocationId: 4040,
  partnerId: 99,
};
const ticketDetailsRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  siteLocationId: 4040,
  workTypeId: 60,
};
const siteRow = { name: "Pad B", address: "123 Field Rd", partnerId: 99 };
const workTypeRow = { name: "Hot Oil", requiredCertifications: [] as string[] };
const partnerRow = { name: "BigOps" };

const SCHEDULED_AT = "2026-05-01T15:00:00.000Z";

beforeEach(async () => {
  selectQueue = [];
  insertReturningQueue = [];
  notifyUsersMock.mockClear();
  sendPushToUserMock.mockClear();
  vi.resetModules();
  const router = (await import("./ticketSchedule")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

function queueForCrew(
  crewRows: Array<{
    id: number;
    userId: number | null;
    firstName?: string;
    lastName?: string;
  }>,
) {
  return [
    ticketRow,
    crewRows.map((c) => ({
      id: c.id,
      userId: c.userId,
      firstName: c.firstName ?? "First",
      lastName: c.lastName ?? "Last",
      vendorId: VENDOR_ID,
    })),
    ticketDetailsRow,
    siteRow,
    workTypeRow,
    partnerRow,
    [], // conflict-detection query — no overlapping tickets
  ];
}

function insertedCrewRows(
  rows: Array<{ id: number; addedAt: Date }>,
) {
  return rows.map((r) => ({ employeeId: r.id, addedAt: r.addedAt }));
}

describe("POST /tickets/:id/schedule — Task #636 / Task #642 crew_added fan-out", () => {
  it("notifies every crew member with a linked user exactly once with the right dedupe key (including addedAt), link, and pushData", async () => {
    const crew = [
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
      { id: 503, userId: 300, firstName: "Pat", lastName: "Lee" },
    ];
    selectQueue = queueForCrew(crew);
    const addedAtByEmp = new Map<number, Date>([
      [501, new Date("2026-04-28T16:00:00.000Z")],
      [502, new Date("2026-04-28T16:00:01.000Z")],
      [503, new Date("2026-04-28T16:00:02.000Z")],
    ]);
    insertReturningQueue = [
      insertedCrewRows(crew.map((c) => ({ id: c.id, addedAt: addedAtByEmp.get(c.id)! }))),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 120,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(notifyUsersMock).toHaveBeenCalledTimes(crew.length);

    const calls = notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][];

    // Recipients are exactly the linked userIds, one per call.
    const recipients = calls.map((c) => c[0]).sort((a, b) => a[0] - b[0]);
    expect(recipients).toEqual([[100], [200], [300]]);

    // Each call carries the crew_added contract: type, link,
    // dedupeKey scoped to (ticketId, employeeId, addedAtIso), and the
    // pushData mobile uses to deep-link to /tickets/<id>. The
    // addedAtIso suffix is what unblocks re-scheduling (Task #642).
    const byEmployee = new Map<number, Record<string, unknown>>();
    for (const [, payload] of calls) {
      const dedupe = String((payload as { dedupeKey: string }).dedupeKey);
      const m = dedupe.match(/^crew_added:(\d+):(\d+):(.+)$/);
      expect(m).not.toBeNull();
      const ticketIdInKey = Number(m![1]);
      const empId = Number(m![2]);
      const addedAtIso = m![3];
      expect(ticketIdInKey).toBe(TICKET_ID);
      expect(addedAtIso).toBe(addedAtByEmp.get(empId)!.toISOString());
      byEmployee.set(empId, payload);

      expect(payload.type).toBe("crew_added");
      expect(payload.link).toBe(`/tickets/${TICKET_ID}`);
      expect(payload.pushData).toEqual({
        ticketId: TICKET_ID,
        type: "crew_added",
      });
      expect(typeof payload.title).toBe("string");
      expect(payload.body as string).toContain("VNDRLY-00007777");
    }
    // One call per crew member (no duplicates, none missed).
    expect([...byEmployee.keys()].sort((a, b) => a - b)).toEqual([501, 502, 503]);
  });

  it("does NOT notify the actor when the foreman schedules themselves into the crew", async () => {
    // Crew of two: 501 is the admin actor (userId=ADMIN_USER_ID), 502 is someone else.
    const crew = [
      { id: 501, userId: ADMIN_USER_ID, firstName: "Self", lastName: "Adder" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    selectQueue = queueForCrew(crew);
    const ADDED_AT_502 = new Date("2026-04-28T16:00:01.000Z");
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 502, addedAt: ADDED_AT_502 },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([200]);
    expect(payload.dedupeKey).toBe(
      `crew_added:${TICKET_ID}:502:${ADDED_AT_502.toISOString()}`,
    );
    // Sanity: the actor's user id never appears as a recipient.
    for (const call of notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][]) {
      expect(call[0]).not.toContain(ADMIN_USER_ID);
    }
  });

  it("skips crew members whose vendor_people row has no linked user account", async () => {
    // Crew of two: 501 has no login, 502 does. Only 502 should be notified.
    const crew = [
      { id: 501, userId: null, firstName: "No", lastName: "Login" },
      { id: 502, userId: 300, firstName: "Pat", lastName: "Lee" },
    ];
    selectQueue = queueForCrew(crew);
    const ADDED_AT_502 = new Date("2026-04-28T16:00:01.000Z");
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 502, addedAt: ADDED_AT_502 },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([300]);
    expect(payload.dedupeKey).toBe(
      `crew_added:${TICKET_ID}:502:${ADDED_AT_502.toISOString()}`,
    );
  });

  it("uses a different dedupeKey when the same crew is re-scheduled, so the second push still fires (Task #642)", async () => {
    const crew = [
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];

    // First schedule — inserted rows have a first set of addedAt
    // timestamps (the route soft-removed nothing because there was no
    // prior crew, then inserted these fresh rows).
    selectQueue = queueForCrew(crew);
    const FIRST_ADDED_AT = {
      501: new Date("2026-04-28T16:00:00.000Z"),
      502: new Date("2026-04-28T16:00:01.000Z"),
    };
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: FIRST_ADDED_AT[501] },
        { id: 502, addedAt: FIRST_ADDED_AT[502] },
      ]),
    ];
    const r1 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });
    expectStatus(r1, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);

    // Re-schedule with the SAME crew. The route soft-removes the old
    // ticket_crew rows and inserts fresh rows with NEW addedAt
    // timestamps. The dedupe key embeds those new timestamps, so the
    // unique (user_id, dedupe_key) index does NOT collapse the second
    // round of pushes — the worker is told they were re-scheduled.
    selectQueue = queueForCrew(crew);
    const SECOND_ADDED_AT = {
      501: new Date("2026-04-28T18:30:00.000Z"),
      502: new Date("2026-04-28T18:30:01.000Z"),
    };
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: SECOND_ADDED_AT[501] },
        { id: 502, addedAt: SECOND_ADDED_AT[502] },
      ]),
    ];
    const r2 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });
    expectStatus(r2, 200);

    // Two more calls (one per crew member) — total of four across both posts.
    expect(notifyUsersMock).toHaveBeenCalledTimes(4);
    const dedupeKeys = (notifyUsersMock.mock.calls as unknown as [
      number[],
      { dedupeKey: string },
    ][]).map((c) => c[1].dedupeKey);

    expect(dedupeKeys).toEqual([
      `crew_added:${TICKET_ID}:501:${FIRST_ADDED_AT[501].toISOString()}`,
      `crew_added:${TICKET_ID}:502:${FIRST_ADDED_AT[502].toISOString()}`,
      `crew_added:${TICKET_ID}:501:${SECOND_ADDED_AT[501].toISOString()}`,
      `crew_added:${TICKET_ID}:502:${SECOND_ADDED_AT[502].toISOString()}`,
    ]);
    // The whole point of Task #642: the per-employee dedupe keys must
    // differ across the two scheduling events so the unique index does
    // not silently collapse the re-schedule push.
    expect(dedupeKeys[0]).not.toBe(dedupeKeys[2]);
    expect(dedupeKeys[1]).not.toBe(dedupeKeys[3]);
  });
});
