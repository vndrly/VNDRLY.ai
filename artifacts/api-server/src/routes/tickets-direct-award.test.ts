import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

// Coverage for Task #495 — POST /tickets/direct-award.
//
// Scope: route-level guards only. The compliance + tier math is exercised
// by lib/vendor-tier.test.ts, and the full happy-path round-trip is left
// to the e2e suite. Here we mock the DB chain and the vendor-tier helper
// so we can prove:
//   * unauthenticated and non-partner callers are rejected
//   * required body fields are enforced
//   * cross-partner attempts are rejected
//   * already-awarded jobs are rejected
//   * compliance/work-type failures from isDirectAwardEligible bubble up
//   * happy path inserts ticket and flips hotlist job to awarded


const cookieFor = (s: object) => buildTestCookie(s);

// ── Per-test mutable rows the chained-mock DB returns ──
let hotlistJobRow: any = null;
let siteRow: any = null;
let workTypeRow: any = null;
let vendorRow: any = null;
let assignmentRow: any = null;
let updatedHotlist: any = null;
let insertedTicket: any = { id: 9001 };
let ticketQueryRow: any = null;
let eligibilityResult: any = { eligible: true };

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

vi.mock("../lib/vendor-tier", () => ({
  isDirectAwardEligible: vi.fn(async () => eligibilityResult),
  getVendorTier: vi.fn(async () => "approved"),
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  let selectStep = 0;
  const db: any = {
    select: () => {
      // Read order in /tickets/direct-award:
      //   0: hotlistJobsTable
      //   1: siteLocationsTable
      //   2: workTypesTable
      //   3: vendorsTable
      // Anything after that is the post-tx ticketQuery() join, which
      // returns the enriched ticket row used for the response and
      // notification copy.
      const seq = [
        () => makeChain([hotlistJobRow].filter(Boolean)),
        () => makeChain([siteRow].filter(Boolean)),
        () => makeChain([workTypeRow].filter(Boolean)),
        () => makeChain([vendorRow].filter(Boolean)),
      ];
      const fn = seq[selectStep] ?? (() => makeChain([ticketQueryRow].filter(Boolean)));
      selectStep += 1;
      return fn();
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([insertedTicket]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updatedHotlist ? [updatedHotlist] : []),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn({
      ...db,
      // Inside the tx, the assignment lookup runs first (returns
      // [assignmentRow] if present), then insert ticket, then update
      // hotlist. The select sequence here is independent of the outer
      // counter — we use a fresh inline chain.
      select: () => makeChain([assignmentRow].filter(Boolean)),
    }),
  };
  (db as any).__resetSelectStep = () => {
    selectStep = 0;
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

vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: vi.fn(async () => undefined),
}));

let app: express.Express;

const baseBody = {
  hotlistJobId: 100,
  vendorId: 7,
  siteLocationId: 11,
  workTypeId: 22,
  scheduledDurationMinutes: 60,
};

const partnerCookie = cookieFor({
  userId: 1,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

beforeEach(async () => {
  hotlistJobRow = {
    id: 100,
    partnerId: 5,
    status: "open",
    title: "Roof patch — Building A",
    deletedAt: null,
  };
  siteRow = {
    id: 11,
    partnerId: 5,
    latitude: 40.0,
    longitude: -74.0,
    name: "Site A",
  };
  workTypeRow = { id: 22, name: "Roofing" };
  vendorRow = {
    id: 7,
    name: "Acme Roofing",
    latitude: 40.01,
    longitude: -74.01,
    operatingRadiusMiles: 50,
  };
  assignmentRow = null;
  updatedHotlist = { id: 100, status: "awarded", awardedVendorId: 7 };
  insertedTicket = { id: 9001 };
  // Task #882: row shape comes from `makeTicketRow`, the single source
  // of truth for the `ticketSelect` projection. The overrides below pin
  // only the fields this happy-path actually checks (status, intake
  // channel, ids, names, scheduled duration, site lat/lng); every other
  // required field comes from the helper so a future addition to
  // `GetTicketResponse` fails the helper's drift guard instead of
  // silently turning the post-tx zod parse into a 500.
  ticketQueryRow = makeTicketRow({
    id: 9001,
    siteLocationId: 11,
    vendorId: 7,
    workTypeId: 22,
    status: "awaiting_acceptance",
    intakeChannel: "partner_self_service",
    siteName: "Site A",
    vendorName: "Acme Roofing",
    workTypeName: "Roofing",
    partnerName: "Acme Partner",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 1,
    createdByName: "Partner User",
    lifecycleState: "pending_arrival",
    siteLatitude: 40.0,
    siteLongitude: -74.0,
    scheduledDurationMinutes: 60,
  });
  eligibilityResult = { eligible: true };
  vi.resetModules();
  const router = (await import("./tickets")).default;
  const db = (await import("@workspace/db")).db as any;
  if (typeof db.__resetSelectStep === "function") db.__resetSelectStep();
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /tickets/direct-award — auth & body validation", () => {
  it("returns 401 with no session cookie", async () => {
    const res = await request(app).post("/api/tickets/direct-award").send(baseBody);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
    expect(res.body.error).toBe("auth_required");
  });

  it("returns 403 when caller is a vendor", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send(baseBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.partner_role_required");
    expect(res.body.error).toBe("partner_role_required");
  });

  it("returns 400 when hotlistJobId is missing", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send({ ...baseBody, hotlistJobId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.hotlist_job_id_required");
    expect(res.body.error).toBe("hotlist_job_id_required");
  });

  it("returns 400 when vendorId is missing", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send({ ...baseBody, vendorId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.vendor_id_required");
    expect(res.body.error).toBe("vendor_id_required");
  });

  it("returns 400 when siteLocationId is missing", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send({ ...baseBody, siteLocationId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.site_location_id_required");
    expect(res.body.error).toBe("site_location_id_required");
  });

  it("returns 400 when workTypeId is missing", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send({ ...baseBody, workTypeId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.work_type_id_required");
    expect(res.body.error).toBe("work_type_id_required");
  });
});

describe("POST /tickets/direct-award — resource & ownership guards", () => {
  it("returns 404 when hotlist job is missing", async () => {
    hotlistJobRow = null;
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("hotlist.not_found");
    expect(res.body.error).toBe("hotlist_job_not_found");
  });

  it("returns 403 when hotlist job belongs to a different partner", async () => {
    hotlistJobRow = { ...hotlistJobRow, partnerId: 999 };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("hotlist.forbidden_not_owning_partner");
    expect(res.body.error).toBe("forbidden_not_owning_partner");
  });

  it("returns 409 hotlist_job_not_open when job has already been awarded", async () => {
    hotlistJobRow = { ...hotlistJobRow, status: "awarded" };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("hotlist.not_open");
    expect(res.body.error).toBe("hotlist_job_not_open");
  });

  it("returns 403 when site belongs to a different partner", async () => {
    siteRow = { ...siteRow, partnerId: 999 };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("site.forbidden_not_owning_partner");
    expect(res.body.error).toBe("site_forbidden");
  });

  it("returns 404 when work type is missing", async () => {
    workTypeRow = null;
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("work_type.not_found");
    expect(res.body.error).toBe("work_type_not_found");
  });

  it("returns 400 vendor_no_operating_area when vendor has no radius", async () => {
    vendorRow = { ...vendorRow, operatingRadiusMiles: null };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("vendor.no_operating_area");
    expect(res.body.error).toBe("vendor_no_operating_area");
  });

  it("returns 400 vendor_out_of_radius when site is outside vendor radius", async () => {
    // Set the vendor 200 mi away with a tiny 10mi radius.
    vendorRow = { ...vendorRow, latitude: 43.0, longitude: -74.0, operatingRadiusMiles: 10 };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("vendor.out_of_radius");
    expect(res.body.error).toBe("vendor_out_of_radius");
  });
});

describe("POST /tickets/direct-award — compliance + happy path", () => {
  it("returns 400 with the helper's error code when compliance fails", async () => {
    eligibilityResult = {
      eligible: false,
      reason: "missing_coi_document",
      message: "Vendor has no COI document on file",
    };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("vendor.missing_coi_document");
    expect(res.body.error).toBe("missing_coi_document");
  });

  it("returns 400 work_type_not_supported when vendor lacks the work type", async () => {
    eligibilityResult = {
      eligible: false,
      reason: "work_type_not_supported",
      message: "Vendor does not perform this work type",
    };
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("vendor.work_type_not_supported");
    expect(res.body.error).toBe("work_type_not_supported");
  });

  it("returns 201 and creates a ticket when all checks pass", async () => {
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expectStatus(res, 201);
    expect(res.body.id).toBe(9001);
    expect(res.body.status).toBe("awaiting_acceptance");
    expect(res.body.lifecycleState).toBe("pending_arrival");
  });

  it("returns 409 hotlist_job_state_changed when CAS update returns no rows", async () => {
    // Simulates a concurrent award: the optimistic UPDATE ... WHERE status='open'
    // matches zero rows, the tx throws, and the route surfaces 409.
    updatedHotlist = null;
    const res = await request(app)
      .post("/api/tickets/direct-award")
      .set("Cookie", partnerCookie)
      .send(baseBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("hotlist.state_changed");
    expect(res.body.error).toBe("hotlist_job_state_changed");
  });
});
