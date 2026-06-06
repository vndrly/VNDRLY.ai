import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { makeTicketRow } from "../test-utils/ticket-row";

// Coverage for Task #498 — POST /tickets phone-intake + intake_channel
// resolution. We use the same chained-mock recipe as
// tickets-disperse-funds.test.ts so we can exercise the route without
// standing up a real database.
//
// What we lock down here:
//   * Default intake_channel is derived from role: partner→psv,
//     field_employee→vfss, vendor/admin→office_*.
//   * Office channels with phoneIntakeCallerName persist
//     `phone_intake_caller:<name>` to the initial transition row.
//   * acceptanceImplicit=true on office_on_behalf_of_partner skips the
//     vendor accept gate (status=initiated instead of awaiting_acceptance).
//   * foremanUserId on office_on_behalf_of_field_employee writes to the
//     ticket row.
//   * partner sessions cannot escalate by claiming office_* in the body.


const cookieFor = (s: object) => buildTestCookie(s);

// Per-test mutable fixtures. Tests push rows into `selectQueue` in the
// exact order POST /tickets will read them; the chained-mock pops one row
// per `db.select(...)` call. After the queue is drained, every further
// select resolves to []. This avoids the brittleness of "select step N
// always means X" across roles, since partner sessions skip the
// site-assignment read entirely while vendor sessions do not.
let selectQueue: any[] = [];
let insertedTicket: any = null;
let ticketQueryRow: any = null;
let insertValuesSpy = vi.fn();
let userIsVendorOfficeMock = vi.fn(async (..._args: unknown[]) => true);
// Default: any foremanUserId resolves to vendor_people row id 25 on the
// target vendor. Tests override this when they want to exercise the
// cross-vendor rejection path (Task #507).
let getForemanVendorPersonIdMock = vi.fn(
  async (_userId: number, _vendorId: number): Promise<number | null> => 25,
);

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

vi.mock("../lib/office-role", () => ({
  userIsVendorOffice: (...args: any[]) => userIsVendorOfficeMock(...args),
  getForemanVendorPersonId: (userId: number, vendorId: number) =>
    getForemanVendorPersonIdMock(userId, vendorId),
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      // Pop the next expected row off the queue. After the queue is
      // drained we fall back to ticketQueryRow so the route's final
      // ticketQuery() join always resolves to a usable row.
      const row = selectQueue.length > 0 ? selectQueue.shift() : ticketQueryRow;
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
    ticketLineItemsTable: tableTag("ticketLineItems"),
    taxRatesTable: tableTag("taxRates"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    // Task #51 — referenced by unread-comments.ts subqueries.
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
}));

let app: express.Express;

const partnerCookie = cookieFor({
  userId: 7,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

const vendorCookie = cookieFor({
  userId: 9,
  role: "vendor",
  vendorId: 11,
  partnerId: null,
});

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const baseBody = {
  siteLocationId: 1,
  vendorId: 11,
  workTypeId: 2,
  description: null,
  checkInLatitude: 0,
  checkInLongitude: 0,
};

// Helpers tests use to seed the chained-mock with the exact reads each
// session role triggers in POST /tickets.
const baseSiteRow = () => ({
  id: 1,
  partnerId: 5,
  latitude: 30,
  longitude: -90,
  siteRadiusMeters: 200,
});

function seedPartnerReads() {
  // partner role: only the site lookup happens before the transaction.
  selectQueue = [baseSiteRow()];
}

function seedVendorReads() {
  // vendor role: site lookup, then Task #517 split site-assignment guards
  // (1: any site+vendor row, 2: site+vendor+work_type row).
  selectQueue = [baseSiteRow(), { id: 1 }, { id: 1 }];
}

function seedAdminReads() {
  // admin role: only the site lookup (no tenancy guard).
  selectQueue = [baseSiteRow()];
}

beforeEach(async () => {
  selectQueue = [];
  insertedTicket = { id: 4242 };
  // Task #584: row shape comes from `makeTicketRow`, the single source
  // of truth for the `ticketSelect` projection. Phone-intake tickets
  // start in `awaiting_acceptance` with `lifecycleState=pending_arrival`
  // and the office_* intake channel; the site coordinates seed the
  // geofence path used by a few of the assertions below.
  ticketQueryRow = makeTicketRow({
    id: 4242,
    status: "awaiting_acceptance",
    intakeChannel: "office_on_behalf_of_partner",
    checkInTime: null,
    lifecycleState: "pending_arrival",
    siteLatitude: 30,
    siteLongitude: -90,
    siteRadiusMeters: 200,
  });
  insertValuesSpy = vi.fn();
  recordTransitionMock.mockClear();
  userIsVendorOfficeMock = vi.fn(async () => true);
  getForemanVendorPersonIdMock = vi.fn(async () => 25);

  vi.resetModules();
  const { default: ticketsRouter } = await import("./tickets");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", ticketsRouter);
  // Surface unexpected errors instead of letting express swallow them as 500s.
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /tickets — phone intake + intake_channel resolution", () => {
  it("partner session defaults to partner_self_service + awaiting_acceptance", async () => {
    seedPartnerReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("partner_self_service");
    expect(inserted.status).toBe("awaiting_acceptance");
  });

  it("partner cannot escalate to office_* via body — 403", async () => {
    // Per Task #498 the phone-intake gate hard-rejects partner sessions
    // (only admin/vendor-office may use the office_* channels and the
    // associated phoneIntakeCallerName attribution).
    seedPartnerReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", partnerCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        phoneIntakeCallerName: "Mallory",
      });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.phone_intake_role_required");
    expect(r.body.error).toBe("phone_intake_role_required");
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("vendor session phone intake (partner caller) → office_on_behalf_of_partner + awaiting_acceptance", async () => {
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        phoneIntakeCallerName: "Pat Partner",
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_partner");
    expect(inserted.status).toBe("awaiting_acceptance");

    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.reason).toBe("phone_intake_caller:Pat Partner");
    expect(tx.toStatus).toBe("awaiting_acceptance");
  });

  it("acceptanceImplicit=true on office_on_behalf_of_partner skips accept gate (status=initiated)", async () => {
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        acceptanceImplicit: true,
        phoneIntakeCallerName: "Pat Partner",
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.status).toBe("initiated");
  });

  it("vendor session phone intake (FE caller) → office_on_behalf_of_field_employee with foreman set + status=in_progress", async () => {
    // Per Task #498 the FE-phone-in-to-office flow short-circuits both the
    // accept gate AND the geofence gate: the field employee is already on
    // the ground coordinating the work, so the office is just dispatching
    // for them. Result must be in_progress on insert.
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        fieldEmployeeId: 25,
        intakeChannel: "office_on_behalf_of_field_employee",
        foremanUserId: 142,
        phoneIntakeCallerName: "Frank Foreman",
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_field_employee");
    expect(inserted.foremanUserId).toBe(142);
    expect(inserted.status).toBe("in_progress");
    expect(inserted.lifecycleState).toBe("on_site");
    expect(inserted.checkInTime).toBeTruthy();

    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.reason).toBe("phone_intake_caller:Frank Foreman");
  });

  it("admin can claim office channel even when vendor-office check would fail", async () => {
    seedAdminReads();
    userIsVendorOfficeMock = vi.fn(async () => false);
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", adminCookie)
      .send({
        ...baseBody,
        fieldEmployeeId: 25,
        intakeChannel: "office_on_behalf_of_field_employee",
        foremanUserId: 142,
        phoneIntakeCallerName: "Frank",
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_field_employee");
    expect(inserted.foremanUserId).toBe(142);
  });

  it("missing phoneIntakeCallerName falls back to standard 'ticket created' reason", async () => {
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
      });
    expectStatus(r, 201);
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.reason).toBe("ticket created");
  });

  // ── Authz hardening tests added in response to architect review ───
  it("non-office vendor user using phone-intake fields gets 403", async () => {
    // Pretend the vendor user isn't on a vendor_people row with role
    // office/both. Per Task #498 the server must reject phone-intake
    // attempts (caller name, acceptanceImplicit, or explicit
    // intakeChannel) with 403 — silent fallback would mask UI bugs and
    // let non-office vendors fabricate caller attribution.
    userIsVendorOfficeMock = vi.fn(async () => false);
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        acceptanceImplicit: true,
        phoneIntakeCallerName: "Pat Partner",
      });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ticket.phone_intake_role_required");
    expect(r.body.error).toBe("phone_intake_role_required");
    // Nothing should have been written.
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  it("non-office vendor user creating a plain ticket (no phone-intake fields) still succeeds", async () => {
    // Regression guard: the pre-existing "Create Job" flow (which any
    // vendor user can reach) must continue to work for non-office
    // vendor users. Only the phone-intake-specific affordances trip
    // the office-role gate.
    userIsVendorOfficeMock = vi.fn(async () => false);
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({ ...baseBody });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    // Default channel for a vendor session is still office_*.
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_partner");
    // No phone-intake caller-name attribution.
    const tx = recordTransitionMock.mock.calls[0]![0] as any;
    expect(tx.reason).not.toMatch(/^phone_intake_caller:/);
  });

  it("vendor session cannot spoof foreman on a vfss ticket via body", async () => {
    // Even if a vendor user posts intakeChannel=vendor_field_self_service
    // (which they aren't authorized for and which falls back to
    // office_on_behalf_of_partner), the body.foremanUserId must NOT be
    // accepted — only admin or office_on_behalf_of_field_employee
    // (post-authz) can attribute foreman.
    seedVendorReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "vendor_field_self_service",
        foremanUserId: 9999,
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    // Vendor cannot claim vfss → channel stays office_on_behalf_of_partner.
    expect(inserted.intakeChannel).toBe("office_on_behalf_of_partner");
    // foremanUserId came from the body (9999) but the actor is NOT
    // admin and the channel isn't office_on_behalf_of_field_employee
    // (which would have authorized it), so we drop it to null.
    expect(inserted.foremanUserId).toBeNull();
  });

  it("admin can attribute foreman freely on any channel", async () => {
    seedAdminReads();
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", adminCookie)
      .send({
        ...baseBody,
        foremanUserId: 555,
      });
    expectStatus(r, 201);
    const inserted = insertValuesSpy.mock.calls[0]?.[0];
    expect(inserted.foremanUserId).toBe(555);
  });

  // ── Task #507: foremanUserId tenancy guard ───────────────────────
  it("rejects foremanUserId that does not belong to the ticket's vendor", async () => {
    // Simulate the cross-vendor case: the office operator (or a buggy
    // / malicious client) picks a foreman user id whose vendor_people
    // row is on a different vendor. getForemanVendorPersonId returns
    // null and the route must hard-reject with 400 instead of writing
    // the bad attribution to ticket.foreman_user_id.
    seedVendorReads();
    getForemanVendorPersonIdMock = vi.fn(async () => null);
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        fieldEmployeeId: 25,
        intakeChannel: "office_on_behalf_of_field_employee",
        foremanUserId: 9999, // user id from a *different* vendor
        phoneIntakeCallerName: "Frank Foreman",
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.foreman_vendor_mismatch");
    expect(r.body.error).toBe("foreman_vendor_mismatch");
    // Nothing should have been written to the tickets table or the
    // status-history audit log.
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  // ── Task #517: structured site / work-type validation codes ───────
  it("rejects with site_not_found when the site row doesn't exist", async () => {
    // site lookup returns no rows → hard 400 with a structured code so
    // the office intake form can flag the site picker inline. (Pushing
    // an explicit `null` forces the chained-mock to return `[]` instead
    // of falling back to ticketQueryRow when the queue empties.)
    selectQueue = [null];
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({ ...baseBody });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("site.not_found");
    expect(r.body.error).toBe("site_not_found");
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects with site_vendor_mismatch when vendor has no assignment at the site", async () => {
    // site exists, but the site-vendor assignment lookup returns no row
    // → hard 400 with a structured code so the front end can flag the
    // site picker inline.
    selectQueue = [baseSiteRow(), null];
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        phoneIntakeCallerName: "Pat Partner",
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.site_vendor_mismatch");
    expect(r.body.error).toBe("site_vendor_mismatch");
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects with work_type_not_allowed when site+vendor exists but no row for the work type", async () => {
    // site exists, site+vendor assignment exists, but no row for the
    // requested work type at this site+vendor combo → hard 400 so the
    // front end can flag the work-type picker inline.
    selectQueue = [baseSiteRow(), { id: 1 }, null];
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        intakeChannel: "office_on_behalf_of_partner",
        phoneIntakeCallerName: "Pat Partner",
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("field_ticket.work_type_not_allowed");
    expect(r.body.error).toBe("work_type_not_allowed");
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects when fieldEmployeeId and foremanUserId reference different vendor_people rows", async () => {
    // foremanUserId resolves to a real vendor_people row on the right
    // vendor (id=25), but the body attached fieldEmployeeId=99 — a
    // different vendor_people row. office_on_behalf_of_field_employee
    // means "the named FE is also the foreman", so this is a 400.
    seedVendorReads();
    getForemanVendorPersonIdMock = vi.fn(async () => 25);
    const r = await request(app)
      .post("/api/tickets")
      .set("Cookie", vendorCookie)
      .send({
        ...baseBody,
        fieldEmployeeId: 99,
        intakeChannel: "office_on_behalf_of_field_employee",
        foremanUserId: 142,
        phoneIntakeCallerName: "Frank",
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ticket.foreman_field_employee_mismatch");
    expect(r.body.error).toBe("foreman_field_employee_mismatch");
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });
});
