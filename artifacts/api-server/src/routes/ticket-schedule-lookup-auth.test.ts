import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #228 — coverage for the tightened auth on the two scheduling
// lookup endpoints:
//   GET /api/sites/:id/weather
//   GET /api/work-types/:id/required-certifications
//
// Both endpoints used to allow any logged-in user. They now reject
// callers who can't tie themselves to at least one ticket on the
// resource being looked up — same shape as the rest of the scheduling
// APIs. These tests pin down two outcomes per endpoint:
//   1. A logged-in vendor "member" (no admin role, no ticket linkage)
//      gets a 403 with `forbidden_not_scheduler`.
//   2. A platform admin always gets through (smoke test that the helper
//      does not also reject the legitimate caller).

const cookieFor = (s: object) => buildTestCookie(s);

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
      values: () => ({ returning: () => Promise.resolve([]) }),
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

vi.mock("../lib/expo-push", () => ({
  sendPushToUser: vi.fn(async () => undefined),
}));

vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => 1),
}));

vi.mock("./crew", () => ({
  notifyRemovedCrewMember: vi.fn(async () => undefined),
}));

let app: express.Express;

beforeEach(async () => {
  selectQueue = [];
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

const VENDOR_ID = 12;
const SITE_ID = 5050;
const WORK_TYPE_ID = 80;

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

// A vendor "member" caller — has no admin membership row and is not
// foreman / crew on any ticket touching the looked-up resource. The
// helper should walk past the admin short-circuit, fail to find an
// admin membership row, and 403.
const vendorMemberCookie = cookieFor({
  userId: 999,
  role: "vendor",
  vendorId: VENDOR_ID,
  partnerId: null,
});

describe("GET /api/sites/:id/weather — Task #228 access tightening", () => {
  it("rejects a vendor member with no scheduling tie to the site (403)", async () => {
    // Two selects are reachable for the vendor-member path:
    //   (1) admin membership lookup → empty (not an admin)
    //   (2) (would be the linked-ticket lookup but is short-circuited)
    // Helper falls through to 403 without hitting the weather upstream.
    selectQueue = [[]]; // no admin membership row

    const r = await request(app)
      .get(`/api/sites/${SITE_ID}/weather`)
      .set("Cookie", vendorMemberCookie);

    expectStatus(r, 403);
    expect(r.body.error).toBe("forbidden_not_scheduler");
    expect(r.body.code).toBe("site.no_access");
  });

  it("returns 401 for unauthenticated callers", async () => {
    const r = await request(app).get(`/api/sites/${SITE_ID}/weather`);
    expectStatus(r, 401);
    expect(r.body.code).toBe("auth.not_authenticated");
  });

  it("lets a platform admin through to the weather lookup", async () => {
    // Admin short-circuit → next select is the site-coordinates lookup.
    // Returning a row with null coords lands on the explicit 404 branch
    // (`site.missing_coordinates`), which proves the auth helper let
    // the request through without hitting the upstream service.
    selectQueue = [
      [{ latitude: null, longitude: null, name: "Pad A" }], // site row
    ];

    const r = await request(app)
      .get(`/api/sites/${SITE_ID}/weather`)
      .set("Cookie", adminCookie);

    expectStatus(r, 404);
    expect(r.body.code).toBe("site.missing_coordinates");
  });
});

describe(
  "GET /api/work-types/:id/required-certifications — Task #228 access tightening",
  () => {
    it("rejects a vendor member with no scheduling tie to the work type (403)", async () => {
      selectQueue = [[]]; // no admin membership row

      const r = await request(app)
        .get(`/api/work-types/${WORK_TYPE_ID}/required-certifications`)
        .set("Cookie", vendorMemberCookie);

      expectStatus(r, 403);
      expect(r.body.error).toBe("forbidden_not_scheduler");
      expect(r.body.code).toBe("work_type.no_access");
    });

    it("returns 401 for unauthenticated callers", async () => {
      const r = await request(app).get(
        `/api/work-types/${WORK_TYPE_ID}/required-certifications`,
      );
      expectStatus(r, 401);
      expect(r.body.code).toBe("auth.not_authenticated");
    });

    it("lets a platform admin through to the work-type lookup", async () => {
      // Admin short-circuit → next select is the work-types row lookup.
      selectQueue = [
        [{ id: WORK_TYPE_ID, name: "Hot Oil", requiredCertifications: ["H2S"] }],
      ];

      const r = await request(app)
        .get(`/api/work-types/${WORK_TYPE_ID}/required-certifications`)
        .set("Cookie", adminCookie);

      expectStatus(r, 200);
      expect(r.body.id).toBe(WORK_TYPE_ID);
      expect(r.body.requiredCertifications).toEqual(["H2S"]);
    });
  },
);
