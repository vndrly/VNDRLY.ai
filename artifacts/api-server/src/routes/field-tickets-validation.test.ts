import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

// Coverage for Task #528 — POST /api/field/tickets must emit the same
// structured error codes the office POST /tickets endpoint emits so the
// mobile new-ticket screen (artifacts/vndrly-mobile/app/new-ticket.tsx)
// can surface the validation inline next to the offending picker:
//   * site_not_found       → site picker is wrong (site row gone)
//   * site_vendor_mismatch → site picker is wrong (vendor not at site)
//   * work_type_not_allowed → work-type picker is wrong (vendor at site
//                              but not for this work type)


const cookieFor = (s: object) => buildTestCookie(s);

let selectQueue: any[] = [];
let insertedTicket: any = null;
let insertValuesSpy = vi.fn();

function makeChain(rows: any) {
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
      const row = selectQueue.length > 0 ? selectQueue.shift() : null;
      return makeChain(row != null ? [row] : []);
    },
    insert: () => ({
      values: (vals: any) => {
        insertValuesSpy(vals);
        return {
          returning: () => Promise.resolve(insertedTicket ? [insertedTicket] : []),
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
    execute: async () => ({ rows: [] }),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    workTypesTable: tableTag("workTypes"),
    fieldEmployeesTable: tableTag("fieldEmployees"),
    partnersTable: tableTag("partners"),
    gpsLogsTable: tableTag("gpsLogs"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
    ticketUnlocksTable: tableTag("ticketUnlocks"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    pushTokensTable: tableTag("pushTokens"),
    fieldPushTokensTable: tableTag("fieldPushTokens"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    workTypePartnerOverridesTable: tableTag("workTypePartnerOverrides"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

const recordTransitionMock = vi.fn(async () => undefined);
vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: recordTransitionMock,
}));

let app: express.Express;

const fieldCookie = cookieFor({
  userId: 1234,
  role: "field_employee",
  vendorId: 11,
  partnerId: null,
});

const baseBody = {
  siteLocationId: 1,
  workTypeId: 2,
  description: null,
  latitude: 30,
  longitude: -90,
  initialState: "on_site",
};

const fieldEmployeeRow = {
  id: 555,
  vendorId: 11,
  firstName: "Frank",
  lastName: "Field",
  email: "ff@example.com",
  isActive: true,
  vendorName: "Acme",
};

const siteRow = {
  id: 1,
  partnerId: 5,
  latitude: 30,
  longitude: -90,
  siteRadiusMeters: 500,
};

beforeEach(async () => {
  insertedTicket = { id: 7777 };
  insertValuesSpy = vi.fn();
  recordTransitionMock.mockClear();

  vi.resetModules();
  const { default: fieldRouter } = await import("./field");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", fieldRouter);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/field/tickets — structured validation codes", () => {
  it("rejects with site_not_found when the site row doesn't exist", async () => {
    // Reads (in order): vendor_people, then site_locations (returns
    // null → triggers the site_not_found short-circuit).
    selectQueue = [fieldEmployeeRow, null];
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_not_found");
    expect(r.body.error).toBe("site_not_found");
    // The mobile new-ticket screen reads `err.data.error` to surface
    // the validation inline on the site picker — making sure no ticket
    // got written or pushed before the bail-out.
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("rejects with site_vendor_mismatch when vendor has no assignment at the site", async () => {
    // Reads: vendor_people, site (exists), combined (vendor, site,
    // work_type) → null, then narrowing (vendor, site) → null. The
    // route disambiguates via the second read and emits the
    // site-picker code.
    selectQueue = [fieldEmployeeRow, siteRow, null, null];
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_vendor_mismatch");
    expect(r.body.error).toBe("site_vendor_mismatch");
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("rejects with work_type_not_allowed when site+vendor exists but no row for the work type", async () => {
    // Reads: vendor_people, site (exists), combined (vendor, site,
    // work_type) → null, then narrowing (vendor, site) → row. This is
    // the case the legacy 403 covered; it now lands as a 400 with the
    // same code the office endpoint emits.
    selectQueue = [fieldEmployeeRow, siteRow, null, { id: 88 }];
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.work_type_not_allowed");
    expect(r.body.error).toBe("work_type_not_allowed");
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("creates the ticket when the combined site+vendor+work-type assignment exists", async () => {
    // Happy-path sanity check. The route only does the narrower
    // (vendor, site) query when the combined check misses, so 3 reads
    // are enough here (vendor_people, site, combined assignment).
    selectQueue = [fieldEmployeeRow, siteRow, { id: 99 }];
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expectStatus(r, 201);
    expect(insertValuesSpy).toHaveBeenCalledTimes(2); // ticket insert + gps log
  });
});
