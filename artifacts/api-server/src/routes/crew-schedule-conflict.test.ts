import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #645: regression coverage for the double-booking confirmation
// branch on POST /tickets/:id/schedule. The route runs an "is anyone
// in this crew already scheduled at the same time on another ticket?"
// check before saving and, when the overlap query returns rows, short-
// circuits with `{ requiresConfirm: true, conflicts: [...] }` so the
// schedule modal can ask the dispatcher to confirm. There was no test
// for this branch — a future refactor of the
// `COALESCE(scheduledDurationMinutes, 60) * INTERVAL '1 minute'` math
// could silently let dispatchers double-book without the modal ever
// asking. Mirrors the mocking recipe from
// crew-schedule-added-notification.test.ts.
//
// What we assert:
//   1. When the overlap query returns a row, the response is 200 with
//      `requiresConfirm: true` and a populated `conflicts` array
//      (employeeId, employeeName, otherTicketId, otherStartAt,
//      otherDurationMinutes, ...).
//   2. Passing `force: true` bypasses the confirmation entirely and
//      writes the schedule (response carries `ok: true`).
//   3. An empty overlap result proceeds to save without prompting.
//   4. No persistent `crew_added` notification (and no in-memory push)
//      fires on the `requiresConfirm` short-circuit path.


const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 8888;
const VENDOR_ID = 22;
const ADMIN_USER_ID = 1;

const adminCookie = cookieFor({
  userId: ADMIN_USER_ID,
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

// crew.ts is imported by ticketSchedule for `notifyRemovedCrewMember`.
// We don't exercise the dropped-crew path here, but stub it to keep the
// import side-effect free.
const notifyRemovedCrewMemberMock = vi.fn(async () => undefined);
vi.mock("./crew", () => ({
  notifyRemovedCrewMember: (...args: unknown[]) =>
    (notifyRemovedCrewMemberMock as unknown as (
      ...a: unknown[]
    ) => Promise<void>)(...args),
}));

let app: express.Express;

// Select sequence in POST /tickets/:id/schedule for an admin caller:
//   (1) ensureSchedulerAuth → loadTicketForAuth (tickets joined sites)
//   (2) crew validation lookup → vendor_people rows for crewEmployeeIds
//   (3) ticket details → tickets row (id, vendorId, siteLocationId, workTypeId)
//   (4) site row → name, address, partnerId
//   (5) work_type row → name, requiredCertifications
//   (6) partner row → name (only if site row was returned)
//   (7) conflict-detection join — present when crew length > 0 and !force
//       (omitted from the queue when force=true; the route skips the query)
//   (— cert warnings query is skipped when requiredCertifications is empty)
//   (— previousCrew query falls through to [] from the queue tail)
const ticketRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "scheduled",
  siteLocationId: 5050,
  partnerId: 77,
};
const ticketDetailsRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  siteLocationId: 5050,
  workTypeId: 70,
};
const siteRow = { name: "Pad C", address: "999 Field Rd", partnerId: 77 };
const workTypeRow = { name: "Frac", requiredCertifications: [] as string[] };
const partnerRow = { name: "MegaOps" };

const SCHEDULED_AT = "2026-06-01T15:00:00.000Z";

beforeEach(async () => {
  selectQueue = [];
  notifyUsersMock.mockClear();
  sendPushToUserMock.mockClear();
  notifyRemovedCrewMemberMock.mockClear();
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

function queuePrefix(
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
  ];
}

describe("POST /tickets/:id/schedule — Task #645 double-booking confirmation", () => {
  it("returns 200 with requiresConfirm and a populated conflicts array when the overlap query finds a clash", async () => {
    const crew = [
      { id: 601, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 602, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];

    const otherStart = new Date("2026-06-01T15:30:00.000Z");
    const overlapRows = [
      {
        employeeId: 601,
        employeeFirst: "Alex",
        employeeLast: "Doe",
        otherTicketId: 9001,
        otherStartAt: otherStart,
        otherDurationMinutes: 90,
        otherWorkType: "Wireline",
        otherSiteName: "Pad Z",
      },
    ];

    selectQueue = [...queuePrefix(crew), overlapRows];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 120,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.requiresConfirm).toBe(true);
    expect(Array.isArray(r.body.conflicts)).toBe(true);
    expect(r.body.conflicts).toHaveLength(1);
    expect(r.body.conflicts[0]).toEqual({
      employeeId: 601,
      employeeName: "Alex Doe",
      otherTicketId: 9001,
      otherWorkType: "Wireline",
      otherSiteName: "Pad Z",
      otherStartAt: otherStart.toISOString(),
      otherDurationMinutes: 90,
    });
    // Short-circuit: no `ok:true` save payload.
    expect(r.body.ok).toBeUndefined();
  });

  it("does NOT fan out crew_added (or any push) on the requiresConfirm short-circuit path", async () => {
    const crew = [
      { id: 601, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 602, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];

    const overlapRows = [
      {
        employeeId: 602,
        employeeFirst: "Sam",
        employeeLast: "Roe",
        otherTicketId: 9002,
        otherStartAt: new Date("2026-06-01T15:45:00.000Z"),
        otherDurationMinutes: null,
        otherWorkType: null,
        otherSiteName: null,
      },
    ];

    selectQueue = [...queuePrefix(crew), overlapRows];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 60,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.requiresConfirm).toBe(true);
    // The schedule never gets persisted on this branch, so neither the
    // persistent `crew_added` row nor the in-memory `ticket_scheduled`
    // push should fire. A future refactor that accidentally falls
    // through past the short-circuit would trip these.
    expect(notifyUsersMock).not.toHaveBeenCalled();
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("bypasses the confirmation entirely when force=true and writes the schedule", async () => {
    const crew = [
      { id: 601, userId: 100, firstName: "Alex", lastName: "Doe" },
    ];

    // force=true means the route skips the conflict-detection query
    // altogether — no overlap row needs to be queued.
    selectQueue = [...queuePrefix(crew)];

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 120,
        crewEmployeeIds: crew.map((c) => c.id),
        force: true,
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(r.body.ticketId).toBe(TICKET_ID);
    expect(r.body.requiresConfirm).toBeUndefined();
    expect(r.body.conflicts).toBeUndefined();
    // The save path runs the persistent crew_added fan-out.
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsersMock.mock.calls[0] as unknown as [
      number[],
      Record<string, unknown>,
    ];
    expect(recipients).toEqual([100]);
    // Task #631: the dedupe key includes the new ticket_crew row's
    // `addedAt` ISO timestamp so re-scheduling the same person fires a
    // fresh push instead of collapsing on the unique
    // `(user_id, dedupe_key)` index. The chained-mock `insert(...).
    // returning()` here resolves to `[]`, so the route falls back to the
    // per-request `now`. We assert the legacy prefix plus a parsable ISO
    // suffix rather than the exact timestamp.
    expect(typeof payload.dedupeKey).toBe("string");
    const dedupeKey = payload.dedupeKey as string;
    const prefix = `crew_added:${TICKET_ID}:601:`;
    expect(dedupeKey.startsWith(prefix)).toBe(true);
    const ts = dedupeKey.slice(prefix.length);
    expect(Number.isFinite(new Date(ts).getTime())).toBe(true);
  });

  it("proceeds to save (no requiresConfirm) when the overlap query returns no rows", async () => {
    const crew = [
      { id: 601, userId: 100, firstName: "Alex", lastName: "Doe" },
    ];

    selectQueue = [...queuePrefix(crew), []];

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
    expect(r.body.ticketId).toBe(TICKET_ID);
    expect(r.body.requiresConfirm).toBeUndefined();
    expect(r.body.conflicts).toBeUndefined();
    // Empty overlap → save proceeds → fan-out happens.
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
  });
});
