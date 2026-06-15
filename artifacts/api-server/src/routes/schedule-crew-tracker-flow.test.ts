import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #229: end-to-end regression coverage for the Phase 2 scheduling
// flow on a draft ticket — the same sequence the schedule modal walks
// through in the field web app:
//
//   1. POST /api/tickets/:id/schedule       (pick crew + foreman, save)
//   2. GET  /api/tickets/:id/crew-tracker   (the live tracker the modal
//                                            opens on success)
//   3. GET  /api/tickets/:id/schedule.ics   (the .ics download link
//                                            shown next to the tracker)
//
// Until now this flow was only exercised by manual / one-off e2e runs.
// A future refactor of the ticket detail page, the schedule transaction,
// or any of the support queries (cert checks, conflict detection, ICS
// formatting) could regress one of the three endpoints without anyone
// noticing until field crews started reporting that "Add to Calendar"
// or the live crew tracker stopped working.
//
// This file mirrors the in-process supertest + `vi.mock("@workspace/db")`
// recipe used by the sibling `crew-schedule-*.test.ts` specs so it
// runs in CI alongside them via the `test-api` workflow without needing
// a live Postgres instance.
//
// What we assert:
//   * The POST returns 200 with `ok: true` and the canonical response
//     shape (scheduledStartAt + crewEmployeeIds + foremanUserId echoed
//     back, no cert warnings on a clean draft).
//   * The crew-tracker GET returns the saved roster with each member's
//     ack status and a null lastPing/distance/ETA when no GPS pings
//     exist (the realistic state moments after dispatch).
//   * The .ics GET returns a `text/calendar` body whose VEVENT carries
//     the saved DTSTART/DTEND, a UID derived from the ticket id, and
//     the work type + partner in SUMMARY — i.e. an actual valid iCal
//     file the user can import, not just a 200 with arbitrary bytes.

const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 9001;
const VENDOR_ID = 31;
const ADMIN_USER_ID = 1;
const SITE_LOCATION_ID = 4242;
const PARTNER_ID = 77;
const WORK_TYPE_ID = 60;

const adminCookie = cookieFor({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

// One queue feeds every `db.select(...)` / `db.selectDistinct(...)` chain
// the route makes — each call shifts one entry, which is the rows the
// chain's terminal `.then` / `.where` will resolve with. Ordering is
// the schema-of-truth here; the per-test setup helpers below build
// queues that mirror the route's exact select sequence.
let selectQueue: any[] = [];
// Rows the next `.insert(...).values(...).returning()` resolves with.
// Only the ticket_crew insert in POST /schedule uses `.returning()`.
let insertReturningQueue: any[][] = [];
// Rows the next `db.execute(sql\`...\`)` resolves with. The crew-tracker
// route reaches `db.execute` only when at least one crew member has a
// vendor_people row whose user_id maps back to a ticket the user is the
// fieldEmployee on. We keep this empty in the happy-path test so the
// "no live ping yet" assertions are deterministic.
let executeRowsQueue: Array<any[]> = [];

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
  const popRows = () => {
    const head = selectQueue.shift();
    return head == null ? [] : Array.isArray(head) ? head : [head];
  };
  const db: any = {
    select: () => makeChain(popRows()),
    // The GET /schedule endpoint uses selectDistinct for warning kinds.
    // Same queue — tests just enqueue an extra entry when needed.
    selectDistinct: () => makeChain(popRows()),
    insert: () => ({
      values: () => {
        const next: any = {
          returning: () => {
            const rows = insertReturningQueue.shift() ?? [];
            return Promise.resolve(rows);
          },
          // Some inserts (scheduled_notifications) `await values(...)`
          // directly without `.returning()`.
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
    execute: async () => {
      const rows = executeRowsQueue.shift() ?? [];
      // The route reads either `.rows` or the value directly — match
      // both shapes so it doesn't matter which path it picks.
      return { rows };
    },
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
    scheduleCertOverrideAuditLogTable: tableTag("scheduleCertOverrideAuditLog"),
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

const notifyRemovedCrewMemberMock = vi.fn(async () => undefined);
vi.mock("./crew", () => ({
  notifyRemovedCrewMember: (...args: unknown[]) =>
    (notifyRemovedCrewMemberMock as unknown as (
      ...a: unknown[]
    ) => Promise<void>)(...args),
}));

let app: express.Express;

const ticketAuthRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "draft",
  siteLocationId: SITE_LOCATION_ID,
  partnerId: PARTNER_ID,
};

// Ticket details select inside POST /schedule (id, vendorId,
// siteLocationId, workTypeId, previousScheduledStartAt,
// previousScheduledDurationMinutes). A draft ticket has no prior
// schedule, so both previous* fields are null.
const ticketDetailsRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  siteLocationId: SITE_LOCATION_ID,
  workTypeId: WORK_TYPE_ID,
  previousScheduledStartAt: null,
  previousScheduledDurationMinutes: null,
};
const siteRow = {
  name: "Pad C",
  address: "456 Lease Rd, Midland, TX",
  partnerId: PARTNER_ID,
};
const workTypeRow = {
  name: "Hot Oil",
  // Empty arrays short-circuit both the cert-warnings query and the
  // hard-blocking cert path so the POST flows straight through.
  requiredCertifications: [] as string[],
  blockingCertifications: [] as string[],
};
const partnerRow = { name: "BigOps Energy" };

const SCHEDULED_AT = "2026-05-04T14:00:00.000Z";
const DURATION_MINUTES = 180;

const crew = [
  { id: 501, userId: 100, firstName: "Alex", lastName: "Doe" },
  { id: 502, userId: 200, firstName: "Sam", lastName: "Roe" },
];
const FOREMAN_USER_ID = 100;

beforeEach(async () => {
  selectQueue = [];
  insertReturningQueue = [];
  executeRowsQueue = [];
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

// Select sequence for POST /tickets/:id/schedule, admin caller, draft
// ticket, no required/blocking certs, no warningKinds, no force=true:
//   (1) ensureSchedulerAuth → loadTicketForAuth (tickets+sites)
//   (2) crew validation lookup → vendor_people for crewEmployeeIds
//   (3) ticket details (tickets row, including previous* fields)
//   (4) site row
//   (5) work_type row
//   (6) partner row (because site row is non-null)
//   (7) conflict-detection join (crew length > 0 and !force)
//   (— cert query is skipped: no required and no blocking certs)
//   (8) previousCrew snapshot (active rows on this ticket)
function queueForSchedulePost() {
  selectQueue = [
    ticketAuthRow,
    crew.map((c) => ({
      id: c.id,
      userId: c.userId,
      firstName: c.firstName,
      lastName: c.lastName,
      vendorId: VENDOR_ID,
    })),
    ticketDetailsRow,
    siteRow,
    workTypeRow,
    partnerRow,
    [], // conflict-detection: no overlapping tickets
    [], // previousCrew: nothing was on the roster yet
  ];
  insertReturningQueue = [
    crew.map((c, i) => ({
      employeeId: c.id,
      addedAt: new Date(`2026-05-01T16:00:0${i}.000Z`),
    })),
  ];
}

// Select sequence for GET /tickets/:id/crew-tracker, admin caller,
// crew with linked userIds but no live pings:
//   (1) ensureSchedulerAuth → loadTicketForAuth
//   (2) site + scheduled_start lookup
//   (3) active crew (ticketCrew leftJoin vendorPeople)
//   (4) vendor_people lookup for the crew's user ids → empty so the
//       allEmpIds branch (and its db.execute call) is skipped
function queueForCrewTracker() {
  selectQueue = [
    ticketAuthRow,
    {
      siteLocationId: SITE_LOCATION_ID,
      siteName: siteRow.name,
      siteLatitude: "31.9973",
      siteLongitude: "-102.0779",
      scheduledStartAt: new Date(SCHEDULED_AT),
    },
    crew.map((c) => ({
      employeeId: c.id,
      ackStatus: "pending",
      ackAt: null,
      userId: c.userId,
      firstName: c.firstName,
      lastName: c.lastName,
    })),
    [], // vendor_people lookup → empty: forces "no recent pings" branch
  ];
}

// Select sequence for GET /tickets/:id/schedule.ics, admin caller:
//   (1) ensureSchedulerAuth → loadTicketForAuth
//   (2) ticket + site + partner + work_type + vendor join
function queueForScheduleIcs() {
  selectQueue = [
    ticketAuthRow,
    {
      scheduledStartAt: new Date(SCHEDULED_AT),
      scheduledDurationMinutes: DURATION_MINUTES,
      siteName: siteRow.name,
      siteAddress: siteRow.address,
      partnerName: partnerRow.name,
      workTypeName: workTypeRow.name,
      vendorName: "Acme Hot Oil Services",
    },
  ];
}

describe("Phase 2 schedule + crew tracker flow (Task #229)", () => {
  it("schedules a draft ticket via POST /tickets/:id/schedule", async () => {
    queueForSchedulePost();

    const res = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: DURATION_MINUTES,
        crewEmployeeIds: crew.map((c) => c.id),
        foremanUserId: FOREMAN_USER_ID,
      });

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      ok: true,
      ticketId: TICKET_ID,
      scheduledStartAt: SCHEDULED_AT,
      scheduledDurationMinutes: DURATION_MINUTES,
      foremanUserId: FOREMAN_USER_ID,
      crewEmployeeIds: crew.map((c) => c.id),
      certWarnings: [],
      certExpiringSoon: [],
    });
    // No conflict prompt was returned; the modal would have moved on
    // to the success state (which opens the crew tracker).
    expect(res.body.requiresConfirm).toBeUndefined();

    // Each crew member with a linked user gets a persistent crew_added
    // notification (inbox + push via notifyUsers) — no duplicate
    // in-memory-only ticket_scheduled push.
    expect(sendPushToUserMock).not.toHaveBeenCalled();

    // The persistent `crew_added` fan-out fires once per genuinely-new
    // crew member, skipping anyone whose user id matches the scheduler
    // (admin) actor. Here the admin is user 1 and isn't on the crew, so
    // both members get an inbox row.
    expect(notifyUsersMock).toHaveBeenCalledTimes(crew.length);
    const recipients = (
      notifyUsersMock.mock.calls as unknown as [number[], unknown][]
    ).map((c) => c[0][0]);
    expect(recipients.sort((a, b) => a - b)).toEqual([100, 200]);
    expect(recipients).not.toContain(ADMIN_USER_ID);
    // Each call carries a crew_added dedupe key bound to (ticket,
    // employee, addedAt) — the contract every downstream surface
    // (badge, mobile inbox, push) keys off.
    for (const call of notifyUsersMock.mock.calls as unknown as [
      number[],
      Record<string, unknown>,
    ][]) {
      expect(call[1].type).toBe("crew_added");
      expect(call[1].link).toBe(`/tickets/${TICKET_ID}`);
      expect(String(call[1].dedupeKey)).toMatch(
        new RegExp(`^crew_added:${TICKET_ID}:\\d+:`),
      );
    }
  });

  it("returns the saved roster from GET /tickets/:id/crew-tracker", async () => {
    queueForCrewTracker();

    const res = await request(app)
      .get(`/api/tickets/${TICKET_ID}/crew-tracker`)
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    expect(res.body.ticketId).toBe(TICKET_ID);
    expect(res.body.site.name).toBe(siteRow.name);
    expect(res.body.scheduledStartAt).toBe(
      new Date(SCHEDULED_AT).toISOString(),
    );
    expect(typeof res.body.avgRoadSpeedKmh).toBe("number");

    expect(res.body.crew).toHaveLength(crew.length);
    const byEmpId = new Map<number, any>(
      (res.body.crew as Array<{ employeeId: number }>).map((c) => [
        c.employeeId,
        c,
      ]),
    );
    for (const c of crew) {
      const entry = byEmpId.get(c.id);
      expect(entry).toBeDefined();
      expect(entry.userId).toBe(c.userId);
      expect(entry.name).toBe(`${c.firstName} ${c.lastName}`);
      expect(entry.ackStatus).toBe("pending");
      // Without any live_ping rows the tracker shows the crew but no
      // distance / ETA — exactly the state the modal opens in the
      // moment after dispatch. A regression that swaps `null` for `0`
      // would silently make every brand-new crew look "on site".
      expect(entry.lastPing).toBeNull();
      expect(entry.distanceMeters).toBeNull();
      expect(entry.etaMinutes).toBeNull();
    }
  });

  it("returns a valid iCal file from GET /tickets/:id/schedule.ics", async () => {
    queueForScheduleIcs();

    const res = await request(app)
      .get(`/api/tickets/${TICKET_ID}/schedule.ics`)
      .set("Cookie", adminCookie);

    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/^text\/calendar/);
    expect(res.headers["content-disposition"]).toContain(
      `vndrly-ticket-${TICKET_ID}.ics`,
    );

    const body = res.text;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("END:VEVENT");
    expect(body).toContain(`UID:vndrly-ticket-${TICKET_ID}@vndrly`);

    // DTSTART/DTEND are RFC 5545 UTC stamps. SCHEDULED_AT is
    // 2026-05-04T14:00:00.000Z + 180 min → 2026-05-04T17:00:00.000Z.
    expect(body).toContain("DTSTART:20260504T140000Z");
    expect(body).toContain("DTEND:20260504T170000Z");
    // SUMMARY embeds work type and partner so the event is recognisable
    // in a personal calendar without opening the description.
    expect(body).toMatch(/SUMMARY:Hot Oil — BigOps Energy/);
    // LOCATION pulls site name + address. Commas inside the address are
    // RFC 5545–escaped to `\,` so they don't terminate the property
    // value, which is what `escapeICS` exists to guarantee.
    const escapedAddress = siteRow.address.replace(/,/g, "\\,");
    expect(body).toContain(`LOCATION:${siteRow.name} — ${escapedAddress}`);
  });

  it("rejects unauthenticated callers across all three endpoints", async () => {
    // Sanity / regression: a missing session cookie still 401's on the
    // POST and on both GETs. A future refactor that ever skipped
    // `ensureSchedulerAuth` on one of them would silently expose the
    // schedule + crew roster of every ticket.
    const post = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .send({ scheduledStartAt: SCHEDULED_AT });
    expectStatus(post, 401);

    const tracker = await request(app).get(
      `/api/tickets/${TICKET_ID}/crew-tracker`,
    );
    expectStatus(tracker, 401);

    const ics = await request(app).get(
      `/api/tickets/${TICKET_ID}/schedule.ics`,
    );
    expectStatus(ics, 401);
  });
});
