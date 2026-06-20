import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { makeTicketRow } from "../test-utils/ticket-row";

// ─────────────────────────────────────────────────────────────────────────
// Task #145 — geofence enforcement on the field-side ticket endpoints.
//
// The visitor public flow (`POST /api/visits/check-in`) already rejects
// off-site coords with a structured `off_geofence` payload that carries
// `distanceMeters` and `radiusMeters`. The field web (`field-new-ticket.tsx`)
// and mobile (`new-ticket.tsx`, `app/ticket/[id].tsx`) screens were
// previously taught to render that payload, but the field endpoints kept
// silently downgrading the create to `pending_arrival` (POST /tickets) or
// accepting the check-in (POST /tickets/:id/check-in), so the new
// distance-aware messages never fired.
//
// This file mirrors the visitor pattern in `visits.test.ts` to lock down
// the new behaviour:
//
//   * POST /tickets with `intakeChannel=vendor_field_self_service` +
//     `initialState=on_site` + GPS outside the geofence → 403 off_geofence.
//   * POST /tickets/:id/check-in with GPS outside the geofence → 403
//     off_geofence (regardless of caller role — check-in is always an
//     "I am physically here" assertion).
//   * Existing channels that intentionally bypass the geofence
//     (office_on_behalf_of_partner, office_on_behalf_of_field_employee,
//     partner_self_service) keep their silent-downgrade behaviour so
//     phone-intake parity from Task #498 isn't regressed.
//   * The `isGeofenceBypassActive()` demo escape hatch the visitor flow
//     honours is honoured here too.
// ─────────────────────────────────────────────────────────────────────────

const cookieFor = (s: object) => buildTestCookie(s);

let selectQueue: any[] = [];
let insertedTicket: any = null;
let ticketQueryRow: any = null;
let insertValuesSpy = vi.fn();
let updateSetSpy = vi.fn();
let isGeofenceBypassActiveMock = vi.fn(() => false);

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
      returning: () => Promise.resolve(rows),
    };
    return next;
  };
  return chain;
}

vi.mock("../lib/office-role", () => ({
  userIsVendorOffice: vi.fn(async () => true),
  getForemanVendorPersonId: vi.fn(async () => 25),
}));

vi.mock("../lib/geo", () => ({
  isGeofenceBypassActive: () => isGeofenceBypassActiveMock(),
  radiusMilesBetween: vi.fn(),
}));

vi.mock("../lib/safety-site-gate", () => ({
  assertSiteActiveForWork: vi.fn(async () => null),
  loadSiteActiveState: vi.fn(async () => ({
    isActive: true,
    status: "active",
    name: "Test Site",
  })),
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      const row = selectQueue.length > 0 ? selectQueue.shift() : ticketQueryRow;
      return makeChain(row != null ? [row] : []);
    },
    insert: () => ({
      values: (vals: any) => {
        insertValuesSpy(vals);
        return {
          returning: () =>
            Promise.resolve(insertedTicket ? [insertedTicket] : []),
        };
      },
    }),
    update: () => ({
      set: (vals: any) => {
        updateSetSpy(vals);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(insertedTicket ? [insertedTicket] : []),
          }),
        };
      },
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
    ticketLineItemsTable: tableTag("ticketLineItems"),
    taxRatesTable: tableTag("taxRates"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    ticketStatusHistoryTable: tableTag("ticketStatusHistory"),
    paymentAuditTable: tableTag("paymentAudit"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  findVendorUserIds: vi.fn(async () => [] as number[]),
  findPartnerUserIds: vi.fn(async () => [] as number[]),
}));

vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

vi.mock("../lib/invoice-generator", () => ({
  enqueueInvoiceGenerationForTicket: vi.fn(async () => undefined),
}));

const recordTransitionMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: recordTransitionMock,
  aggregateVendorTransitions: vi.fn(async () => []),
  aggregatePartnerTransitions: vi.fn(async () => []),
  aggregateAdminReassignments: vi.fn(async () => []),
}));

let app: express.Express;

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const fieldCookie = cookieFor({
  userId: 50,
  role: "field_employee",
  vendorId: 11,
  partnerId: null,
});

const vendorCookie = cookieFor({
  userId: 9,
  role: "vendor",
  vendorId: 11,
  partnerId: null,
});

// Site lat/lng with a 200m radius. The "off-site" coordinates used in
// tests below sit ~111km away (one degree of latitude north), well
// outside any sensible site radius.
const SITE_LAT = 30;
const SITE_LNG = -90;
const SITE_RADIUS = 200;

const baseSiteRow = () => ({
  id: 1,
  partnerId: 5,
  latitude: SITE_LAT,
  longitude: SITE_LNG,
  siteRadiusMeters: SITE_RADIUS,
});

const baseCreateBody = {
  siteLocationId: 1,
  vendorId: 11,
  workTypeId: 2,
  description: null,
};

beforeEach(async () => {
  selectQueue = [];
  insertedTicket = { id: 4242 };
  ticketQueryRow = makeTicketRow({
    id: 4242,
    status: "in_progress",
    intakeChannel: "vendor_field_self_service",
    siteLatitude: SITE_LAT,
    siteLongitude: SITE_LNG,
    siteRadiusMeters: SITE_RADIUS,
  });
  insertValuesSpy = vi.fn();
  updateSetSpy = vi.fn();
  isGeofenceBypassActiveMock = vi.fn(() => false);
  recordTransitionMock.mockClear();

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  attachTestErrorMiddleware(app, { logErrors: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/tickets — geofence rejection on field self-create
// ─────────────────────────────────────────────────────────────────────

// Reads consumed by POST /tickets when the actor is a field_employee:
//   1) site lookup (siteLocationsTable)
//   2) getFieldEmployeeForSession (vendorPeopleTable)
//   3) site+vendor assignment (siteWorkAssignmentsTable)
//   4) site+vendor+work_type assignment (siteWorkAssignmentsTable)
function seedFieldEmployeeReads() {
  selectQueue = [
    baseSiteRow(),
    { id: 99, vendorId: 11 }, // vendor_people row for the FE
    { id: 1 }, // site+vendor assignment
    { id: 1 }, // site+vendor+work_type assignment
  ];
}

// Reads consumed by POST /tickets when the actor is admin:
//   1) site lookup (no tenancy guard; ticketVendorId stays null so the
//      site_vendor / work_type assignment guards are skipped).
function seedAdminCreateReads() {
  selectQueue = [baseSiteRow()];
}

describe("POST /tickets — geofence rejection (Task #145)", () => {
  it("rejects field self-create with off-site GPS as 403 off_geofence", async () => {
    seedFieldEmployeeReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", fieldCookie)
      .send({
        ...baseCreateBody,
        initialState: "on_site",
        // ~111km north of the site → far outside the 200m radius.
        checkInLatitude: SITE_LAT + 1,
        checkInLongitude: SITE_LNG,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.distanceMeters).toBeGreaterThan(SITE_RADIUS);
    expect(res.body.radiusMeters).toBe(SITE_RADIUS);
    // Crucially, no insert and no transition row — the request must
    // bail before reaching the transaction.
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("accepts field self-create when GPS is inside the geofence", async () => {
    seedFieldEmployeeReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", fieldCookie)
      .send({
        ...baseCreateBody,
        initialState: "on_site",
        checkInLatitude: SITE_LAT,
        checkInLongitude: SITE_LNG,
      });
    expectStatus(res, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
    expect(inserted.status).toBe("in_progress");
    expect(inserted.lifecycleState).toBe("on_site");
  });

  it("does not reject when no GPS coords are supplied (legacy pending_arrival path)", async () => {
    // Without coords there is nothing to enforce against — the existing
    // "no GPS → pending_arrival" path must still win so a field employee
    // who hasn't granted location permission can still open a ticket.
    seedFieldEmployeeReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", fieldCookie)
      .send({
        ...baseCreateBody,
        initialState: "on_site",
      });
    expectStatus(res, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
    expect(inserted.lifecycleState).toBe("pending_arrival");
    expect(inserted.checkInTime).toBeNull();
  });

  it("does not reject pending_arrival creates with off-site GPS", async () => {
    // A field employee explicitly opening a pending_arrival ticket isn't
    // claiming to be on-site — the geofence rejection only applies when
    // the caller asserts initialState=on_site.
    seedFieldEmployeeReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", fieldCookie)
      .send({
        ...baseCreateBody,
        initialState: "pending_arrival",
        checkInLatitude: SITE_LAT + 1,
        checkInLongitude: SITE_LNG,
      });
    expectStatus(res, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.lifecycleState).toBe("pending_arrival");
  });

  it("does not reject office_on_behalf_of_partner creates with off-site GPS", async () => {
    // Office channels aren't asserting their own location — the office
    // operator is creating on behalf of a partner who phoned in. Keep
    // the existing silent downgrade so phone-intake parity (Task #498)
    // isn't regressed.
    seedAdminCreateReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", adminCookie)
      .send({
        ...baseCreateBody,
        initialState: "on_site",
        checkInLatitude: SITE_LAT + 1,
        checkInLongitude: SITE_LNG,
      });
    expectStatus(res, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_partner");
    // Silently downgraded to pending_arrival because the geofence
    // bypass for non-FE channels is preserved.
    expect(inserted.lifecycleState).toBe("pending_arrival");
  });

  it("honours the demo geofence-bypass on field self-create", async () => {
    // Demo escape hatch (`isGeofenceBypassActive`) treats any submitted
    // coords as inside the geofence — the create succeeds and lands
    // straight in the on_site / in_progress auto-check-in branch even
    // when the device GPS is far away.
    isGeofenceBypassActiveMock = vi.fn(() => true);
    seedFieldEmployeeReads();
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", fieldCookie)
      .send({
        ...baseCreateBody,
        initialState: "on_site",
        checkInLatitude: SITE_LAT + 1,
        checkInLongitude: SITE_LNG,
      });
    expectStatus(res, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("vendor_field_self_service");
    expect(inserted.lifecycleState).toBe("on_site");
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/tickets/:id/check-in — geofence rejection
// ─────────────────────────────────────────────────────────────────────

// Reads consumed by POST /tickets/:id/check-in when the actor is admin:
//   1) ensureFieldOwnership: short-circuits for admin, no read.
//   2) ensureFieldAssignmentForFieldEmployee: short-circuits for
//      non-field_employee actors, no read.
//   3) siteForGeofence join (Task #145).
// On success it then reads the existing ticket row inside the
// transaction; the geofence-rejection tests bail before that.
function seedAdminCheckInReadsForGeofenceRejection() {
  selectQueue = [
    {
      latitude: SITE_LAT,
      longitude: SITE_LNG,
      siteRadiusMeters: SITE_RADIUS,
    },
  ];
}

// Reads consumed when the check-in is allowed to proceed (admin actor):
//   1) siteForGeofence
//   2) existing ticket row (status + arrivedAt) inside the transaction
//   3) ticketCheckInsTable lookup is gated on updated.fieldEmployeeId,
//      which our insertedTicket fixture leaves null — so no extra reads.
//   4) final ticketQuery for the response, satisfied by ticketQueryRow.
function seedAdminCheckInReadsForHappyPath() {
  selectQueue = [
    {
      latitude: SITE_LAT,
      longitude: SITE_LNG,
      siteRadiusMeters: SITE_RADIUS,
    },
    { arrivedAt: null, status: "in_progress" },
  ];
}

describe("POST /tickets/:id/check-in — geofence rejection (Task #145)", () => {
  it("rejects with 403 off_geofence when coords are outside the site radius", async () => {
    seedAdminCheckInReadsForGeofenceRejection();
    const res = await request(app)
      .post("/api/tickets/4242/check-in")
      .set("Cookie", adminCookie)
      .send({
        latitude: SITE_LAT + 1, // ~111km away
        longitude: SITE_LNG,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.distanceMeters).toBeGreaterThan(SITE_RADIUS);
    expect(res.body.radiusMeters).toBe(SITE_RADIUS);
    // No update, no transition row — the request must bail before the
    // status CAS transaction runs.
    expect(updateSetSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("falls back to the default site radius when the site has no override", async () => {
    // siteRadiusMeters = null on the row → DEFAULT_SITE_RADIUS_METERS used
    selectQueue = [
      { latitude: SITE_LAT, longitude: SITE_LNG, siteRadiusMeters: null },
    ];
    const res = await request(app)
      .post("/api/tickets/4242/check-in")
      .set("Cookie", adminCookie)
      .send({
        latitude: SITE_LAT + 1,
        longitude: SITE_LNG,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.radiusMeters).toBe(1609);
    expect(res.body.distanceMeters).toBeGreaterThan(1609);
  });

  it("accepts the check-in when coords are inside the geofence", async () => {
    seedAdminCheckInReadsForHappyPath();
    const res = await request(app)
      .post("/api/tickets/4242/check-in")
      .set("Cookie", adminCookie)
      .send({
        latitude: SITE_LAT,
        longitude: SITE_LNG,
      });
    expectStatus(res, 200);
    expect(updateSetSpy).toHaveBeenCalled();
    const updated = updateSetSpy.mock.calls[0]![0] as any;
    expect(updated.status).toBe("in_progress");
    expect(updated.lifecycleState).toBe("on_site");
    expect(updated.checkInLatitude).toBe(SITE_LAT);
    expect(updated.checkInLongitude).toBe(SITE_LNG);
  });

  it("honours the demo geofence-bypass and accepts off-site check-ins", async () => {
    // Demo escape hatch parity with the visitor flow — when bypass is
    // active any submitted coords are accepted regardless of distance.
    isGeofenceBypassActiveMock = vi.fn(() => true);
    seedAdminCheckInReadsForHappyPath();
    const res = await request(app)
      .post("/api/tickets/4242/check-in")
      .set("Cookie", adminCookie)
      .send({
        latitude: SITE_LAT + 1,
        longitude: SITE_LNG,
      });
    expectStatus(res, 200);
    expect(updateSetSpy).toHaveBeenCalled();
  });

  it("rejects vendor session check-ins from off-site coords", async () => {
    // Vendor sessions also pass through the geofence gate. The
    // ensureFieldOwnership tenancy lookup runs first (non-admin) so we
    // need to seed an extra row for the ticket-tenancy join before the
    // siteForGeofence read.
    selectQueue = [
      // ensureFieldOwnership: ticket + site partnerId join
      { vendorId: 11, fieldEmployeeId: null, partnerId: 5 },
      // siteForGeofence
      {
        latitude: SITE_LAT,
        longitude: SITE_LNG,
        siteRadiusMeters: SITE_RADIUS,
      },
    ];
    const res = await request(app)
      .post("/api/tickets/4242/check-in")
      .set("Cookie", vendorCookie)
      .send({
        latitude: SITE_LAT + 1,
        longitude: SITE_LNG,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.radiusMeters).toBe(SITE_RADIUS);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});
