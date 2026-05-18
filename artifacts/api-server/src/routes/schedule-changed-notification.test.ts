import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #649 — regression coverage for the `schedule_changed`
// persistent notification that POST /tickets/:id/schedule fires when
// the foreman keeps the same crew but actually moves the job's start
// time or duration. Tasks #631 and #642 ensured a fresh `crew_added`
// fires whenever a crew member is freshly added or re-added — but
// when the crew is unchanged and only the time moved, that generic
// "you've been added to a ticket" push tells the worker nothing
// useful. This task replaces it with a distinct `schedule_changed`
// event for already-on-roster crew members ("Your job's start time
// changed").
//
// What we assert:
//   1. When every crew member was already on the active roster AND
//      the new scheduledStartAt differs from the previous one, the
//      route emits `schedule_changed` (not `crew_added`) per crew
//      member, with a dedupeKey that embeds the NEW start ISO so
//      repeated reschedules don't collapse on the unique
//      (user_id, dedupe_key) index.
//   2. When every crew member was already on the active roster AND
//      neither scheduledStartAt nor scheduledDurationMinutes
//      changed, NO persistent notification is fired (no spurious
//      "you've been added" for a no-op save).
//   3. When the start time is unchanged but the duration shifted,
//      `schedule_changed` still fires (duration is part of the
//      effective schedule).
//   4. Mixed roster: an already-on-roster crew member gets
//      `schedule_changed` (when the schedule moved) while a
//      genuinely-new crew member still gets the established
//      `crew_added` event.
//   5. Two consecutive reschedules to two distinct start times
//      produce two distinct dedupeKeys for the same
//      (ticketId, employeeId) pair, so the second push is not
//      silently dropped by the unique index.

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

const ticketAuthRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "scheduled",
  siteLocationId: 4040,
  partnerId: 99,
};
const siteRow = { name: "Pad B", address: "123 Field Rd", partnerId: 99 };
const workTypeRow = { name: "Hot Oil", requiredCertifications: [] as string[] };
const partnerRow = { name: "BigOps" };

// Original schedule (what the DB currently holds). New POSTs with a
// different start time / duration should be treated as a re-schedule
// of already-on-roster crew.
const PREVIOUS_START = new Date("2026-05-01T15:00:00.000Z");
const PREVIOUS_DURATION_MINUTES = 60;
const NEW_START = "2026-05-01T19:00:00.000Z";

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

// Builds the SELECT queue the route consumes for one POST /schedule
// call. Order matches the route source:
//   (1) ensureSchedulerAuth → loadTicketForAuth
//   (2) vendor_people validation
//   (3) ticket details (now includes previous scheduled fields)
//   (4) site
//   (5) work_type
//   (6) partner
//   (7) conflict overlap
//   (8) previousCrew (active ticket_crew rows for diff)
function queueForPost(opts: {
  crew: Array<{
    id: number;
    userId: number | null;
    firstName?: string;
    lastName?: string;
  }>;
  previousCrewEmployeeIds: number[];
  previousScheduledStartAt: Date | null;
  previousScheduledDurationMinutes: number | null;
}) {
  return [
    ticketAuthRow,
    opts.crew.map((c) => ({
      id: c.id,
      userId: c.userId,
      firstName: c.firstName ?? "First",
      lastName: c.lastName ?? "Last",
      vendorId: VENDOR_ID,
    })),
    {
      id: TICKET_ID,
      vendorId: VENDOR_ID,
      siteLocationId: 4040,
      workTypeId: 60,
      previousScheduledStartAt: opts.previousScheduledStartAt,
      previousScheduledDurationMinutes: opts.previousScheduledDurationMinutes,
    },
    siteRow,
    workTypeRow,
    partnerRow,
    [], // conflict-detection — no overlapping tickets
    opts.previousCrewEmployeeIds.map((id) => ({ employeeId: id })),
  ];
}

function insertedCrewRows(
  rows: Array<{ id: number; addedAt: Date }>,
) {
  return rows.map((r) => ({ employeeId: r.id, addedAt: r.addedAt }));
}

describe("POST /tickets/:id/schedule — Task #649 schedule_changed fan-out", () => {
  it("emits schedule_changed (not crew_added) for already-on-roster crew when only the start time moved", async () => {
    const crew = [
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: crew.map((c) => c.id),
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 502, addedAt: new Date("2026-04-28T16:00:01.000Z") },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: NEW_START,
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(notifyUsersMock).toHaveBeenCalledTimes(crew.length);

    const calls = notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][];

    // Every notification is a schedule_changed event with the
    // expected dedupeKey shape, link, and pushData.
    const seen = new Map<number, Record<string, unknown>>();
    for (const [recipients, payload] of calls) {
      expect(recipients.length).toBe(1);
      const userId = recipients[0];
      expect(payload.type).toBe("schedule_changed");
      expect(payload.link).toBe(`/tickets/${TICKET_ID}`);
      expect(payload.pushData).toEqual({
        ticketId: TICKET_ID,
        type: "schedule_changed",
      });
      const dedupe = String(payload.dedupeKey);
      const m = dedupe.match(/^schedule_changed:(\d+):(\d+):(.+)$/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(TICKET_ID);
      expect(m![3]).toBe(new Date(NEW_START).toISOString());
      seen.set(userId, payload);
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it("emits NO persistent notification when the same crew is re-saved with no schedule change", async () => {
    const crew = [
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: crew.map((c) => c.id),
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 502, addedAt: new Date("2026-04-28T16:00:01.000Z") },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        // Same start + duration as previously stored.
        scheduledStartAt: PREVIOUS_START.toISOString(),
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    // Workers were already on the roster and nothing actionable
    // changed for them, so no inbox spam.
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it("emits schedule_changed when only the duration shifted (start time unchanged)", async () => {
    const crew = [{ id: 501, userId: 100, firstName: "Alex", lastName: "Doe" }];
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: [501],
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: 60,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: PREVIOUS_START.toISOString(),
        // Same start, but a different effective duration counts as
        // a schedule change for the worker.
        scheduledDurationMinutes: 240,
        crewEmployeeIds: [501],
      });

    expectStatus(r, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([100]);
    expect(payload.type).toBe("schedule_changed");
    expect(payload.dedupeKey).toBe(
      `schedule_changed:${TICKET_ID}:501:${PREVIOUS_START.toISOString()}`,
    );
  });

  it("mixed roster: existing crew get schedule_changed, newly-added crew get crew_added", async () => {
    const crew = [
      // 501 was already on the roster — schedule moved, so
      // schedule_changed.
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
      // 503 is new — keep the established crew_added contract.
      { id: 503, userId: 300, firstName: "Pat", lastName: "Lee" },
    ];
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: [501],
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    const ADDED_AT_503 = new Date("2026-04-28T16:00:02.000Z");
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 503, addedAt: ADDED_AT_503 },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: NEW_START,
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);

    const byType = new Map<string, Record<string, unknown>>();
    const byRecipient = new Map<number, Record<string, unknown>>();
    for (const [recipients, payload] of notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][]) {
      byType.set(String(payload.type), payload);
      byRecipient.set(recipients[0], payload);
    }

    // Existing crew member → schedule_changed with NEW start ISO.
    const existing = byRecipient.get(100)!;
    expect(existing.type).toBe("schedule_changed");
    expect(existing.dedupeKey).toBe(
      `schedule_changed:${TICKET_ID}:501:${new Date(NEW_START).toISOString()}`,
    );

    // New crew member → crew_added with the new ticket_crew row's
    // addedAt ISO embedded in the dedupeKey.
    const newcomer = byRecipient.get(300)!;
    expect(newcomer.type).toBe("crew_added");
    expect(newcomer.dedupeKey).toBe(
      `crew_added:${TICKET_ID}:503:${ADDED_AT_503.toISOString()}`,
    );
  });

  it("two reschedules to distinct start times produce two distinct schedule_changed dedupeKeys", async () => {
    const crew = [
      { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
    ];

    // First reschedule: PREVIOUS_START → NEW_START.
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: [501],
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
      ]),
    ];
    const r1 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: NEW_START,
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });
    expectStatus(r1, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);

    // Second reschedule: NEW_START → SECOND_NEW_START. Worker is
    // STILL on the roster from the first reschedule, so this hits
    // the schedule_changed branch again with a DIFFERENT key
    // because the start ISO differs.
    const SECOND_NEW_START = "2026-05-02T13:30:00.000Z";
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: [501],
      previousScheduledStartAt: new Date(NEW_START),
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T18:30:00.000Z") },
      ]),
    ];
    const r2 = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SECOND_NEW_START,
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });
    expectStatus(r2, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);

    const dedupeKeys = (notifyUsersMock.mock.calls as unknown as [
      number[],
      { type: string; dedupeKey: string },
    ][]).map((c) => c[1].dedupeKey);
    expect(dedupeKeys).toEqual([
      `schedule_changed:${TICKET_ID}:501:${new Date(NEW_START).toISOString()}`,
      `schedule_changed:${TICKET_ID}:501:${new Date(SECOND_NEW_START).toISOString()}`,
    ]);
    // The whole point of embedding the new start ISO: keys differ
    // across the two reschedules so the unique
    // (user_id, dedupe_key) index does NOT silently drop the
    // second push.
    expect(dedupeKeys[0]).not.toBe(dedupeKeys[1]);

    // Both notifications are the right type.
    for (const [, payload] of notifyUsersMock.mock.calls as unknown as [
      number[],
      { type: string },
    ][]) {
      expect(payload.type).toBe("schedule_changed");
    }
  });

  it("does NOT notify the actor (foreman who reschedules themselves)", async () => {
    const crew = [
      { id: 501, userId: ADMIN_USER_ID, firstName: "Self", lastName: "Adder" },
      { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    selectQueue = queueForPost({
      crew,
      previousCrewEmployeeIds: crew.map((c) => c.id),
      previousScheduledStartAt: PREVIOUS_START,
      previousScheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
    });
    insertReturningQueue = [
      insertedCrewRows([
        { id: 501, addedAt: new Date("2026-04-28T16:00:00.000Z") },
        { id: 502, addedAt: new Date("2026-04-28T16:00:01.000Z") },
      ]),
    ];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: NEW_START,
        scheduledDurationMinutes: PREVIOUS_DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([200]);
    expect(payload.type).toBe("schedule_changed");
    expect(payload.dedupeKey).toBe(
      `schedule_changed:${TICKET_ID}:502:${new Date(NEW_START).toISOString()}`,
    );
    for (const call of notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][]) {
      expect(call[0]).not.toContain(ADMIN_USER_ID);
    }
  });
});
