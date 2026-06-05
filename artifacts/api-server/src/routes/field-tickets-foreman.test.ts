import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";

// Coverage for Task #498 — POST /api/field/tickets must default
// `foreman_user_id` to the creating field employee's user_id ("suggested
// foreman = self" per the task spec) and accept an explicit overrides
// only when the caller names another vendor person on the SAME vendor
// who is foreman-eligible (vendor_role IN ('foreman','both')). Invalid
// override values silently fall back to self so a buggy or malicious
// client cannot attribute a job to someone who isn't a real foreman on
// this vendor.


const cookieFor = (s: object) => buildTestCookie(s);

// The field route does (in order, on the happy path):
//   1. requireFieldUser → SELECT vendor_people LEFT JOIN vendors WHERE userId
//   2. SELECT site_locations WHERE id (site_not_found guard + geofence)
//   3. SELECT site_work_assignments WHERE (vendor, site, work_type)
// Only on miss in step 3 is a 4th narrowing query issued for
// (vendor, site) to disambiguate site_vendor_mismatch vs.
// work_type_not_allowed. Tasks #498 and #528 — see field.ts for the
// structured-code rationale.
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
    ticketCrewTable: tableTag("ticketCrew"),
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
  userId: 1234, // ← the field employee's user_id; expected on the insert
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

beforeEach(async () => {
  selectQueue = [
    // 1) requireFieldUser → vendor_people LEFT JOIN vendors
    {
      id: 555,
      vendorId: 11,
      firstName: "Frank",
      lastName: "Field",
      email: "ff@example.com",
      isActive: true,
      vendorName: "Acme",
    },
    // 2) site_locations row (site_not_found guard + later geofence math)
    {
      id: 1,
      partnerId: 5,
      latitude: 30,
      longitude: -90,
      siteRadiusMeters: 500,
    },
    // 3) site_work_assignments by (vendor, site, work_type) — happy-path
    //    combined check. Field route only issues the narrower (vendor,
    //    site) query when this misses, so 3 reads is enough for the
    //    create-success scenarios this file covers.
    { id: 99 },
  ];
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

describe("POST /api/field/tickets — adjacent ticket foreman attribution", () => {
  it("sets intake_channel=vendor_field_self_service and foreman_user_id=session.userId", async () => {
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
    // The headline assertion for Task #498's mobile adjacent flow: the
    // creating field employee is recorded as the foreman so any teammate
    // who joins later inherits the same on-site lead.
    expect(inserted.foremanUserId).toBe(1234);
    expect(inserted.fieldEmployeeId).toBe(555);
    expect(inserted.vendorId).toBe(11);
    // Inside the geofence with state="on_site" we expect auto-check-in.
    expect(inserted.status).toBe("in_progress");
  });

  it("silently falls back to self when body-supplied foremanUserId is not a valid foreman on this vendor", async () => {
    // The override-validation lookup runs after the 3 happy-path reads
    // — push a no-row result onto the queue so the lookup misses (e.g.
    // the userId belongs to another vendor, isn't foreman-eligible, or
    // doesn't exist). The route MUST NOT 4xx — the spec wants a silent
    // fall-back to self so a buggy client never blocks ticket creation.
    selectQueue.push(null);
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({ ...baseBody, foremanUserId: 999999 });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.foremanUserId).toBe(1234);
  });

  it("honors a body-supplied foremanUserId when it points to a foreman-eligible person on the same vendor", async () => {
    // The override-validation lookup runs after the 3 happy-path reads.
    // Push a row that simulates a real foreman-eligible vendor_people
    // record on this vendor so the route uses the override.
    selectQueue.push({ userId: 5555 });
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({ ...baseBody, foremanUserId: 5555 });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.foremanUserId).toBe(5555);
    // Channel + field employee attribution are unchanged — only the
    // foreman attribution moves.
    expect(inserted.fieldEmployeeId).toBe(555);
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
  });

  it("treats foremanUserId == session.userId as the no-op default (no validation lookup)", async () => {
    // When the picker's default selection (self) is forwarded, the route
    // should short-circuit and NOT issue the override-validation read —
    // proves both the no-op semantics and that the validation cost is
    // only paid on a real override.
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({ ...baseBody, foremanUserId: 1234 });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.foremanUserId).toBe(1234);
  });

  it("still attributes foreman=self even when geofence misses (status=initiated)", async () => {
    // Replace the site row (index 1 in the queue, right after
    // vendor_people) with one that's far from the user's coordinates so
    // the geofence check fails and the ticket lands on `initiated`.
    // Task #528 moved the site_locations lookup ahead of the assignment
    // checks so the route can emit a structured `site_not_found` code.
    selectQueue[1] = {
      id: 1,
      partnerId: 5,
      latitude: 0,
      longitude: 0,
      siteRadiusMeters: 50,
    };
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send(baseBody);
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.status).toBe("initiated");
    expect(inserted.foremanUserId).toBe(1234);
  });

  it("adjacent=true forces in_progress even when geofence would miss", async () => {
    // Per Task #498: an adjacent ticket is initiated by a field employee
    // who is already on-site for another ticket on the same location, so
    // the new ticket should land directly in_progress regardless of
    // whether the device GPS happens to land inside the geofence at the
    // moment of submission. (Task #528 moved the site_locations lookup
    // to index 1; this fixture replaces it the same way.)
    selectQueue[1] = {
      id: 1,
      partnerId: 5,
      latitude: 0,
      longitude: 0,
      siteRadiusMeters: 50,
    };
    const r = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({ ...baseBody, adjacent: true });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.status).toBe("in_progress");
    expect(inserted.lifecycleState).toBe("on_site");
    expect(inserted.foremanUserId).toBe(1234);
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
  });
});
