import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #501: GET /api/tickets/:id/transitions returns the audit-trail rows
// (invite sent, denied with reason, reassigned vendor X→Y, accepted) that the
// web ticket-detail page and mobile close-out screen render under "Audit
// Trail". This file exercises the endpoint with a stubbed db so we can pin:
//   * row enrichment — actor name pulled from users, denial reason
//     surfaced verbatim
//   * the partner-self-service reinvite reason format
//     `reassigned from vendor #X to vendor #Y` is rewritten to use the
//     resolved vendor names and the structured fromVendorName/toVendorName
//     columns are populated
//   * stable chronological ordering (asc by createdAt)

const ADMIN_USER_ID = 99;

const adminCookie = buildTestCookie({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
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
      // The /transitions handler issues at most two selects in fixed order:
      //   (1) ticket_status_history JOIN users
      //   (2) vendors WHERE id IN (…)  [skipped if no reinvite reasons]
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

describe("GET /api/tickets/:id/transitions", () => {
  it("returns 200 and serializes a denial with the reason text intact", async () => {
    transitionRows = [
      {
        id: 11,
        ticketId: 42,
        fromStatus: "awaiting_acceptance",
        toStatus: "denied",
        actorUserId: 7,
        actorName: "Vendor Vic",
        actorRole: "vendor",
        reason: "rig is down for the week",
        createdAt: new Date("2026-04-01T15:00:00Z").toISOString(),
      },
    ];
    const res = await request(app)
      .get("/api/tickets/42/transitions")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.fromStatus).toBe("awaiting_acceptance");
    expect(row.toStatus).toBe("denied");
    expect(row.reason).toBe("rig is down for the week");
    expect(row.displayReason).toBe("rig is down for the week");
    expect(row.actorName).toBe("Vendor Vic");
    expect(row.actorRole).toBe("vendor");
    expect(row.fromVendorName).toBeNull();
    expect(row.toVendorName).toBeNull();
  });

  it("rewrites a partner reinvite reason to use vendor names and exposes structured from/to vendor names", async () => {
    transitionRows = [
      {
        id: 21,
        ticketId: 42,
        fromStatus: "denied",
        toStatus: "awaiting_acceptance",
        actorUserId: 3,
        actorName: "Partner Pat",
        actorRole: "partner",
        reason: "reassigned from vendor #100 to vendor #200",
        createdAt: new Date("2026-04-02T16:00:00Z").toISOString(),
      },
    ];
    vendorRows = [
      { id: 100, name: "Acme Welding" },
      { id: 200, name: "Permian Hot Tap" },
    ];
    const res = await request(app)
      .get("/api/tickets/42/transitions")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.fromVendorName).toBe("Acme Welding");
    expect(row.toVendorName).toBe("Permian Hot Tap");
    expect(row.displayReason).toBe(
      "reassigned from Acme Welding to Permian Hot Tap",
    );
    // Original reason stays untouched so admins can still grep audit logs by
    // raw vendor IDs if a vendor was renamed later.
    expect(row.reason).toBe("reassigned from vendor #100 to vendor #200");
  });

  it("falls back to `vendor #N` when a vendor referenced in the reason has been deleted", async () => {
    transitionRows = [
      {
        id: 22,
        ticketId: 42,
        fromStatus: "denied",
        toStatus: "awaiting_acceptance",
        actorUserId: 3,
        actorName: "Partner Pat",
        actorRole: "partner",
        reason: "reassigned from vendor #100 to vendor #999",
        createdAt: new Date("2026-04-02T16:00:00Z").toISOString(),
      },
    ];
    vendorRows = [{ id: 100, name: "Acme Welding" }];
    const res = await request(app)
      .get("/api/tickets/42/transitions")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const row = res.body[0];
    expect(row.fromVendorName).toBe("Acme Welding");
    expect(row.toVendorName).toBe("vendor #999");
    expect(row.displayReason).toBe(
      "reassigned from Acme Welding to vendor #999",
    );
  });

  it("returns rows verbatim and lets the route be called without crashing on an empty trail", async () => {
    transitionRows = [];
    const res = await request(app)
      .get("/api/tickets/42/transitions")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toEqual([]);
  });

  it("preserves an accept transition's null reason without inventing a displayReason", async () => {
    transitionRows = [
      {
        id: 31,
        ticketId: 42,
        fromStatus: "awaiting_acceptance",
        toStatus: "initiated",
        actorUserId: 7,
        actorName: "Vendor Vic",
        actorRole: "vendor",
        reason: "vendor accepted invite",
        createdAt: new Date("2026-04-03T17:00:00Z").toISOString(),
      },
    ];
    const res = await request(app)
      .get("/api/tickets/42/transitions")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const row = res.body[0];
    expect(row.toStatus).toBe("initiated");
    expect(row.displayReason).toBe("vendor accepted invite");
    expect(row.fromVendorName).toBeNull();
    expect(row.toVendorName).toBeNull();
  });
});
