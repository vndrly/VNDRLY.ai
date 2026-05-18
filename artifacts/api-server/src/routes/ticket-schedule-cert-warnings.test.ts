import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #646: regression coverage for the certification-warnings branch
// of POST /tickets/:id/schedule. When the work_type has
// `requiredCertifications`, the route returns `certWarnings` listing
// every crew member who is missing or has an expired certification so
// the schedule modal can render an informational banner. The branch
// is purely informational — it never blocks the save (the response is
// still 200) — but a future refactor of the `expirationDate < today`
// comparison or the diffing in the `for (const cr of crewRows)` loop
// could silently drop the warnings (or worse, let expired certs count
// as valid). This test pins down all three outcomes:
//   1. A crew member missing a required cert appears in certWarnings.
//   2. An expired cert (expirationDate before today) is treated as
//      missing, regardless of the cert's name being present.
//   3. A fully-credentialed crew yields an empty certWarnings array.
//   4. The schedule still saves (200 OK) since cert warnings are
//      informational, never blocking.
//
// Mock recipe mirrors crew-schedule-added-notification.test.ts: a
// drizzle-style chainable select queue plus full mocks for
// notifications/expo-push so we never touch real I/O.


const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 8888;
const VENDOR_ID = 12;
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

const notifyRemovedCrewMemberMock = vi.fn(async () => undefined);
vi.mock("./crew", () => ({
  notifyRemovedCrewMember: (...args: unknown[]) =>
    (notifyRemovedCrewMemberMock as unknown as (
      ...a: unknown[]
    ) => Promise<void>)(...args),
}));

let app: express.Express;

// Select sequence in POST /tickets/:id/schedule for an admin caller
// when the work_type has requiredCertifications:
//   (1) ensureSchedulerAuth → loadTicketForAuth (tickets joined sites)
//   (2) crew validation lookup → vendor_people rows for crewEmployeeIds
//   (3) ticket details → tickets row (id, vendorId, siteLocationId, workTypeId)
//   (4) site row → name, address, partnerId
//   (5) work_type row → name, requiredCertifications  ← non-empty in this file
//   (6) partner row → name (only if site row was returned)
//   (7) conflict-detection join → [] (no overlapping tickets)
//   (8) cert warnings query → employee_certifications rows for crew
//   (9) previousCrew lookup (defaults to [] since the queue is exhausted)
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
  workTypeId: 80,
};
const siteRow = { name: "Pad C", address: "456 Field Rd", partnerId: 77 };
const partnerRow = { name: "BigOps" };

const REQUIRED_CERTS = ["H2S", "OSHA-10"];
const workTypeRow = {
  name: "Hot Oil",
  requiredCertifications: REQUIRED_CERTS,
};

const SCHEDULED_AT = "2026-05-01T15:00:00.000Z";

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

function queueForCrewWithCerts(
  crewRows: Array<{
    id: number;
    userId: number | null;
    firstName?: string;
    lastName?: string;
  }>,
  certRows: Array<{
    employeeId: number;
    name: string;
    expirationDate: string | Date | null;
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
    certRows,
  ];
}

// Far in the future relative to today (April 2026 at the time this
// test was authored). Using a fixed date keeps the test deterministic
// even years from now while the route's own `new Date()` advances.
const FUTURE_EXP = "2099-12-31";
// Far in the past — guaranteed expired regardless of when the test runs.
const PAST_EXP = "2000-01-01";

// Task #650: a far-future scheduled start used by the "expiring-soon"
// tests. The route compares the cert's expirationDate against
// `scheduledStartAt + window`, but it also filters anything where
// expirationDate < today as "missing". Using a static SCHEDULED_AT in
// 2026 (the moment these tests were authored) would drift into the
// past as the calendar advances, flipping our "expiring-soon" cert into
// "expired/missing" and breaking the assertion. Anchoring the new tests
// to 2099 keeps both today < exp AND exp ≤ scheduledStart + window
// simultaneously true regardless of when the suite runs.
const FAR_FUTURE_SCHEDULED_AT = "2099-06-01T15:00:00.000Z";
// Helper that returns an ISO yyyy-mm-dd string `daysAfter` days after
// `FAR_FUTURE_SCHEDULED_AT`, used to land an expirationDate inside the
// 30-day amber window deterministically.
function daysAfterFarFutureScheduled(daysAfter: number): string {
  const d = new Date(FAR_FUTURE_SCHEDULED_AT);
  d.setUTCDate(d.getUTCDate() + daysAfter);
  return d.toISOString().slice(0, 10);
}

describe("POST /tickets/:id/schedule — Task #646 certification warnings", () => {
  it("flags a crew member who is missing a required certification", async () => {
    // Pat has H2S but no OSHA-10. Sam has both. Expect Pat to appear
    // in certWarnings with `missing: ["OSHA-10"]`, and Sam to be absent.
    const crew = [
      { id: 601, userId: 100, firstName: "Pat", lastName: "Lee" },
      { id: 602, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    const certs = [
      { employeeId: 601, name: "H2S", expirationDate: FUTURE_EXP },
      { employeeId: 602, name: "H2S", expirationDate: FUTURE_EXP },
      { employeeId: 602, name: "OSHA-10", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForCrewWithCerts(crew, certs);

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 120,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    // Schedule still saves (200) — cert warnings are informational.
    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);

    const warnings = r.body.certWarnings as Array<{
      employeeId: number;
      employeeName: string;
      missing: string[];
    }>;
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].employeeId).toBe(601);
    expect(warnings[0].employeeName).toBe("Pat Lee");
    expect(warnings[0].missing).toEqual(["OSHA-10"]);

    // Task #650: certs in this test are FUTURE_EXP (2099) so well outside
    // the 30-day expiring-soon window — the amber array should be empty.
    expect(r.body.certExpiringSoon).toEqual([]);
  });

  it("treats an expired certification (expirationDate before today) as missing", async () => {
    // Pat's H2S cert is expired and OSHA-10 is current. Pat should
    // appear in certWarnings with `missing: ["H2S"]` even though a
    // row with name="H2S" exists in employee_certifications. This is
    // the regression that's most at risk: dropping the
    // `expirationDate < today` short-circuit would let the expired
    // row count as valid.
    const crew = [
      { id: 701, userId: 100, firstName: "Pat", lastName: "Lee" },
    ];
    const certs = [
      { employeeId: 701, name: "H2S", expirationDate: PAST_EXP },
      { employeeId: 701, name: "OSHA-10", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForCrewWithCerts(crew, certs);

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);

    const warnings = r.body.certWarnings as Array<{
      employeeId: number;
      employeeName: string;
      missing: string[];
    }>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].employeeId).toBe(701);
    expect(warnings[0].missing).toEqual(["H2S"]);
    // Task #650: H2S is missing (expired today), OSHA-10 is FUTURE_EXP, so
    // nothing falls into the amber expiring-soon window.
    expect(r.body.certExpiringSoon).toEqual([]);
  });

  it("returns an empty certWarnings array when every crew member has all required certs current", async () => {
    // Both crew members have current copies of every required cert.
    // certWarnings should be empty and the schedule still saves.
    const crew = [
      { id: 801, userId: 100, firstName: "Alex", lastName: "Doe" },
      { id: 802, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    const certs = [
      { employeeId: 801, name: "H2S", expirationDate: FUTURE_EXP },
      { employeeId: 801, name: "OSHA-10", expirationDate: FUTURE_EXP },
      { employeeId: 802, name: "H2S", expirationDate: FUTURE_EXP },
      { employeeId: 802, name: "OSHA-10", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForCrewWithCerts(crew, certs);

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(r.body.certWarnings).toEqual([]);
    expect(r.body.certExpiringSoon).toEqual([]);
  });

  // Task #650 — new amber tier: cert is currently valid (so it is NOT in
  // `missing`) but its expirationDate falls inside the 30-day window after
  // `scheduledStartAt`. The schedule modal renders this as an
  // informational, visually-distinct heads-up alongside the existing red
  // missing warning. Pinning the new branch here so a future refactor of
  // the expByEmp / requiredSet plumbing can't silently drop the warning
  // (or, worse, let an already-missing cert double up across both tiers).
  it("flags a crew member whose certification expires inside the configurable window after the scheduled start", async () => {
    // Pat: H2S expires 5 days after scheduled start (inside window),
    //      OSHA-10 expires far in the future (clear of window).
    // Sam: both certs far in the future (no warning expected).
    const crew = [
      { id: 901, userId: 100, firstName: "Pat", lastName: "Lee" },
      { id: 902, userId: 200, firstName: "Sam", lastName: "Roe" },
    ];
    const certs = [
      { employeeId: 901, name: "H2S", expirationDate: daysAfterFarFutureScheduled(5) },
      // OSHA-10 expires later but still > 30 days past scheduled start so
      // it's outside the amber window. Using +60d (instead of FUTURE_EXP)
      // is safer because the route picks the soonest expiration per cert
      // and a 2099-12-31 row could collide with the +60d we want.
      { employeeId: 901, name: "OSHA-10", expirationDate: daysAfterFarFutureScheduled(60) },
      { employeeId: 902, name: "H2S", expirationDate: daysAfterFarFutureScheduled(120) },
      { employeeId: 902, name: "OSHA-10", expirationDate: daysAfterFarFutureScheduled(120) },
    ];
    selectQueue = queueForCrewWithCerts(crew, certs);

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: FAR_FUTURE_SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    // No required certs are missing — Pat's H2S is still valid today.
    expect(r.body.certWarnings).toEqual([]);

    const expiring = r.body.certExpiringSoon as Array<{
      employeeId: number;
      employeeName: string;
      expiring: Array<{
        name: string;
        expirationDate: string;
        daysUntilExpiration: number;
      }>;
    }>;
    expect(Array.isArray(expiring)).toBe(true);
    expect(expiring).toHaveLength(1);
    expect(expiring[0].employeeId).toBe(901);
    expect(expiring[0].employeeName).toBe("Pat Lee");
    expect(expiring[0].expiring).toHaveLength(1);
    expect(expiring[0].expiring[0].name).toBe("H2S");
    // ISO string from the DB date should round-trip safely.
    expect(typeof expiring[0].expiring[0].expirationDate).toBe("string");
    // daysUntilExpiration is computed from `today`, so it slides as the
    // calendar advances. Just bound it: the H2S exp is 5 days past
    // scheduledStartAt, which is in the future, so it must be > 0.
    expect(expiring[0].expiring[0].daysUntilExpiration).toBeGreaterThan(0);
  });

  // Task #650 — disjoint-tier guarantee: a missing cert must NEVER also
  // appear in `certExpiringSoon`. If the H2S cert is missing entirely
  // (no row at all), the expiring-soon code path has no expiration to
  // pull from, so it cannot leak into the amber array. This covers the
  // "missing dominates" branch in the per-cert-name loop.
  it("does not double-count a missing cert in certExpiringSoon", async () => {
    const crew = [
      { id: 1001, userId: 100, firstName: "Pat", lastName: "Lee" },
    ];
    // Only OSHA-10 present (and well past the window) — H2S is missing.
    const certs = [
      { employeeId: 1001, name: "OSHA-10", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForCrewWithCerts(crew, certs);

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.certWarnings).toHaveLength(1);
    expect(r.body.certWarnings[0].missing).toEqual(["H2S"]);
    // H2S must not also appear in expiring soon — missing dominates.
    expect(r.body.certExpiringSoon).toEqual([]);
  });
});
