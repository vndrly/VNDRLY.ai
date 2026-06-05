import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #857: filter + CSV export for the per-ticket audit trail and the
// new aggregate cross-ticket export endpoint. Stubs the db so we can pin:
//   * `?kind=denied` filters out non-denied transitions on the per-ticket
//     route while leaving the surrounding pipeline (vendor-name resolve,
//     displayReason rewrite) untouched.
//   * `?actorRole=partner` includes only partner-actor rows; passing
//     `actorRole=system` matches NULL-actor rows.
//   * `?from=`/`?to=` apply inclusive bounds on `createdAt`.
//   * `?format=csv` returns text/csv with the documented header order
//     and an attachment Content-Disposition.
//   * `/tickets/audit-trail/export` requires auth, refuses field
//     employees (403), and applies tenant scope automatically for
//     partner/vendor sessions.

const ADMIN_USER_ID = 99;
const PARTNER_USER_ID = 11;
const FIELD_USER_ID = 22;

const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
});
const partnerCookie = buildTestCookie({
  userId: PARTNER_USER_ID,
  role: "partner",
  vendorId: null,
  partnerId: 7,
});
const fieldCookie = buildTestCookie({
  userId: FIELD_USER_ID,
  role: "field_employee",
  vendorId: 5,
  partnerId: null,
});

let transitionRows: any[] = [];
let vendorRows: any[] = [];
let selectStep = 0;

function thenable(rows: any[]) {
  return {
    then: (resolve: any) => Promise.resolve(rows).then(resolve),
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  } as any;
}

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => thenable(rows),
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
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
      const seq = [
        () => makeChain(transitionRows),
        () => makeChain(vendorRows),
      ];
      const fn = seq[Math.min(selectStep, seq.length - 1)] ?? (() => makeChain([]));
      selectStep += 1;
      return fn();
    },
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
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
    ticketStatusHistoryTable: tableTag("ticketStatusHistory"),
    taxRatesTable: tableTag("taxRates"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = (..._args: any[]) => ({ kind: "true" });
  sqlTag.raw = passthrough;
  sqlTag.join = (..._args: any[]) => ({ kind: "true" });
  return {
    and: passthrough,
    eq: passthrough,
    isNull: passthrough,
    inArray: passthrough,
    sql: sqlTag,
    asc: passthrough,
    desc: passthrough,
    gte: passthrough,
    aliasedTable: (t: any) => t,
  };
});

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  transitionRows = [];
  vendorRows = [];
  selectStep = 0;
  const router = (await import("./tickets")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

const sampleRows = [
  {
    id: 1,
    ticketId: 42,
    fromStatus: null,
    toStatus: "awaiting_acceptance",
    actorUserId: 3,
    actorName: "Partner Pat",
    actorRole: "partner",
    reason: null,
    createdAt: new Date("2026-04-01T10:00:00Z").toISOString(),
  },
  {
    id: 2,
    ticketId: 42,
    fromStatus: "awaiting_acceptance",
    toStatus: "denied",
    actorUserId: 7,
    actorName: "Vendor Vic",
    actorRole: "vendor",
    reason: "rig is down for the week",
    createdAt: new Date("2026-04-02T11:00:00Z").toISOString(),
  },
  {
    id: 3,
    ticketId: 42,
    fromStatus: "denied",
    toStatus: "awaiting_acceptance",
    actorUserId: 3,
    actorName: "Partner Pat",
    actorRole: "partner",
    reason: "reassigned from vendor #100 to vendor #200",
    createdAt: new Date("2026-04-03T12:00:00Z").toISOString(),
  },
  {
    id: 4,
    ticketId: 42,
    fromStatus: "awaiting_acceptance",
    toStatus: "initiated",
    actorUserId: null,
    actorName: null,
    actorRole: null,
    reason: "vendor accepted invite",
    createdAt: new Date("2026-04-04T13:00:00Z").toISOString(),
  },
];

describe("GET /api/tickets/:id/transitions filters", () => {
  it("filters by kind=denied and excludes other rows", async () => {
    transitionRows = sampleRows;
    const res = await request(app)
      .get("/api/tickets/42/transitions?kind=denied")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(2);
    expect(res.body[0].toStatus).toBe("denied");
  });

  it("supports multiple kind values via repeated query params", async () => {
    transitionRows = sampleRows;
    const res = await request(app)
      .get("/api/tickets/42/transitions?kind=denied&kind=accepted")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = res.body.map((r: any) => r.id).sort();
    expect(ids).toEqual([2, 4]);
  });

  it("filters by actorRole=system to surface NULL-actor rows", async () => {
    transitionRows = sampleRows;
    const res = await request(app)
      .get("/api/tickets/42/transitions?actorRole=system")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(4);
    expect(res.body[0].actorRole).toBeNull();
  });

  it("filters by inclusive from/to date bounds on createdAt", async () => {
    transitionRows = sampleRows;
    const res = await request(app)
      .get(
        "/api/tickets/42/transitions?from=2026-04-02T00%3A00%3A00Z&to=2026-04-03T23%3A59%3A59Z",
      )
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = res.body.map((r: any) => r.id).sort();
    expect(ids).toEqual([2, 3]);
  });

  it("returns CSV with header row and filtered rows when format=csv", async () => {
    transitionRows = sampleRows;
    vendorRows = [
      { id: 100, name: "Acme Welding" },
      { id: 200, name: "Permian Hot Tap" },
    ];
    const res = await request(app)
      .get("/api/tickets/42/transitions?format=csv&kind=reinvited")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/ticket-42/);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "id,ticketId,createdAt,fromStatus,toStatus,kind,actorName,actorRole,reason",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("reinvited");
    expect(lines[1]).toContain("Partner Pat");
    // The `vendor #100/#200` reason was rewritten to use vendor names
    // before the CSV row was emitted.
    expect(lines[1]).toContain("Acme Welding");
    expect(lines[1]).toContain("Permian Hot Tap");
  });
});

describe("GET /api/tickets/audit-trail/export", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/tickets/audit-trail/export");
    expectStatus(res, 401);
  });

  it("rejects field-employee sessions with 403", async () => {
    const res = await request(app)
      .get("/api/tickets/audit-trail/export")
      .set("Cookie", fieldCookie);
    expectStatus(res, 403);
    expect(res.body.code).toBe("audit_trail.export_forbidden");
  });

  it("returns CSV for an admin export across multiple tickets", async () => {
    transitionRows = [
      {
        id: 50,
        ticketId: 100,
        fromStatus: "awaiting_acceptance",
        toStatus: "denied",
        actorUserId: 7,
        actorName: "Vendor Vic",
        actorRole: "vendor",
        reason: "no crew",
        createdAt: new Date("2026-04-10T08:00:00Z").toISOString(),
      },
      {
        id: 51,
        ticketId: 101,
        fromStatus: "awaiting_acceptance",
        toStatus: "denied",
        actorUserId: 8,
        actorName: "Vendor Wendy",
        actorRole: "vendor",
        reason: "out of region",
        createdAt: new Date("2026-04-15T08:00:00Z").toISOString(),
      },
      {
        id: 52,
        ticketId: 102,
        fromStatus: null,
        toStatus: "awaiting_acceptance",
        actorUserId: 3,
        actorName: "Partner Pat",
        actorRole: "partner",
        reason: null,
        createdAt: new Date("2026-04-15T09:00:00Z").toISOString(),
      },
    ];
    const res = await request(app)
      .get("/api/tickets/audit-trail/export?kind=denied")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "id,ticketId,createdAt,fromStatus,toStatus,kind,actorName,actorRole,reason",
    );
    // 2 denied rows, header + 2 = 3 lines.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("100");
    expect(lines[2]).toContain("101");
  });

  it("partner sessions get a CSV scoped to their partner automatically", async () => {
    transitionRows = [
      {
        id: 80,
        ticketId: 200,
        fromStatus: "awaiting_acceptance",
        toStatus: "denied",
        actorUserId: 7,
        actorName: "Vendor Vic",
        actorRole: "vendor",
        reason: "rig down",
        createdAt: new Date("2026-04-20T08:00:00Z").toISOString(),
      },
    ];
    const res = await request(app)
      .get("/api/tickets/audit-trail/export")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /partner-11/,
    );
  });
});
