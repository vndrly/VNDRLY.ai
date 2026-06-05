import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for GET /tickets/direct-award/candidates.
//
// Combines two task contracts that both live on this endpoint:
//
//   * Task #495 — auth/route-level guards + tier annotation contract.
//     Proves unauth/non-partner callers are rejected, missing/invalid
//     query params return 400, missing/cross-partner sites return
//     404/403, and the happy-path response carries the tier returned
//     by getVendorTier in the documented sort order.
//
//   * Task #502 — eligibility annotation. Proves ineligible vendors
//     (out of radius, missing geolocation, compliance-floor failures
//     such as missing COI / federal tax id / expired insurance) are
//     RETURNED with structured `ineligibleReason`/`ineligibleMessage`
//     fields and `eligible:false` instead of being silently filtered
//     out at submit time. Eligible vendors must sort before ineligible
//     ones regardless of tier so the partner UI can highlight the
//     pickable rows first.
//
// The compliance-floor math itself is unit-tested in
// lib/vendor-tier.test.ts; here we trust the helper (`checkComplianceFloor`
// is imported from the real module) and focus on the route's annotation
// + ordering logic.
//
// Mirrors the chained-DB-mock pattern used in tickets-direct-award.test.ts
// and tickets-vendor-handshake.test.ts.

const cookieFor = (s: object) => buildTestCookie(s);

// ── Per-test mutable rows the chained-mock DB returns ──
let siteRow: any = null;
let vendorRows: any[] = [];
// Map from vendorId → tier so the happy-path test can assert that the
// route's `tier` field is exactly what getVendorTier returned for each id.
let vendorTierByVendorId: Record<number, "approved" | "unapproved" | "pre_onboarded"> = {};

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

vi.mock("../lib/vendor-tier", async () => {
  // Keep the real `checkComplianceFloor` (pure function over the row
  // data we hand the route) so the eligible/ineligibleReason assertions
  // exercise the actual contract instead of a stub. The DB-backed
  // helpers — `getVendorTier`, `getVendorTiersBatch` (Task #849), and
  // `isDirectAwardEligible` (unused by this endpoint, but imported by
  // the route module) — are replaced with vi.fn stubs that read from
  // the per-test `vendorTierByVendorId` table.
  const actual: any = await vi.importActual("../lib/vendor-tier");
  return {
    ...actual,
    getVendorTier: vi.fn(async (vendorId: number) =>
      vendorTierByVendorId[vendorId] ?? "approved",
    ),
    getVendorTiersBatch: vi.fn(async (vendorIds: number[]) => {
      const m = new Map<number, "approved" | "unapproved" | "pre_onboarded">();
      for (const id of vendorIds) {
        m.set(id, vendorTierByVendorId[id] ?? "approved");
      }
      return m;
    }),
    isDirectAwardEligible: vi.fn(async () => ({ eligible: true })),
  };
});

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  let selectStep = 0;
  const db: any = {
    // Read order in GET /tickets/direct-award/candidates:
    //   0: siteLocationsTable (single site row, .limit(1))
    // Anything after that should never be hit by this endpoint, but we
    // return an empty chain so unrelated reads in shared route setup
    // (none today) would degrade gracefully instead of throwing.
    select: () => {
      const seq = [() => makeChain([siteRow].filter(Boolean))];
      const fn = seq[selectStep] ?? (() => makeChain([]));
      selectStep += 1;
      return fn();
    },
    // Vendor candidate fetch uses selectDistinct(...).innerJoin(...).orderBy(...)
    // — no .where(), so .orderBy must resolve directly to the row array.
    selectDistinct: () => makeChain(vendorRows),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
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

const partnerCookie = cookieFor({
  userId: 1,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

// Date helpers used by the Task #502 compliance-floor cases.
const futureIso = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)
  .toISOString()
  .slice(0, 10);
const pastIso = new Date(Date.now() - 1000 * 60 * 60 * 24)
  .toISOString()
  .slice(0, 10);

beforeEach(async () => {
  // Site that belongs to the calling partner (partnerId=5). Lat/lon are
  // chosen so the in-radius math below has obvious results.
  siteRow = {
    id: 11,
    partnerId: 5,
    latitude: 40.0,
    longitude: -74.0,
  };
  // Three onboarded vendors within radius — one of each tier — plus one
  // out-of-radius vendor. Pre-Task-#502 the route filtered the
  // out-of-radius vendor out entirely; post-Task-#502 it returns it
  // with eligible:false. Both behaviours are asserted in their
  // respective describe blocks below.
  vendorRows = [
    {
      id: 7, // approved
      name: "Acme Roofing",
      latitude: 40.01,
      longitude: -74.01,
      operatingRadiusMiles: 50,
      coiDocumentUrl: "https://example.com/coi-acme.pdf",
      insuranceExpirationDate: "2099-12-31",
      federalTaxId: "12-3456789",
    },
    {
      id: 8, // unapproved (onboarded, no preferred/approved relationship)
      name: "Beta Builders",
      latitude: 40.02,
      longitude: -74.02,
      operatingRadiusMiles: 75,
      coiDocumentUrl: "https://example.com/coi-beta.pdf",
      insuranceExpirationDate: "2099-12-31",
      federalTaxId: "98-7654321",
    },
    {
      id: 9, // pre_onboarded — missing COI keeps them ineligible
      name: "Charlie Contracting",
      latitude: 40.03,
      longitude: -74.03,
      operatingRadiusMiles: 60,
      coiDocumentUrl: null,
      insuranceExpirationDate: "2099-12-31",
      federalTaxId: "11-1111111",
    },
    {
      id: 10, // out-of-radius — filtered (pre-#502) / ineligible (post-#502)
      name: "Delta Distant",
      latitude: 43.0,
      longitude: -74.0,
      operatingRadiusMiles: 5,
      coiDocumentUrl: "https://example.com/coi-delta.pdf",
      insuranceExpirationDate: "2099-12-31",
      federalTaxId: "55-5555555",
    },
  ];
  vendorTierByVendorId = {
    7: "approved",
    8: "unapproved",
    9: "pre_onboarded",
    10: "approved",
  };
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

describe("GET /tickets/direct-award/candidates — auth & role guard", () => {
  it("returns 401 with no session cookie", async () => {
    const res = await request(app).get(
      "/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11",
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
    expect(res.body.error).toBe("auth_required");
  });

  it("returns 403 when caller is a vendor", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.partner_role_required");
    expect(res.body.error).toBe("partner_role_required");
  });

  it("returns 403 when caller is a field employee", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", cookieFor({
        userId: 1,
        role: "field_employee",
        vendorId: 7,
        fieldEmployeeId: 42,
        partnerId: null,
      }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.partner_role_required");
    expect(res.body.error).toBe("partner_role_required");
  });

  it("returns 403 when caller is an admin (admin is not a partner)", async () => {
    // The endpoint is partner-only. Admins normally have broad access
    // elsewhere, but Direct Award candidate listing is keyed off the
    // session.partnerId scope — admins lack one and so cannot be served.
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", cookieFor({ userId: 1, role: "admin", vendorId: null, partnerId: null }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.partner_role_required");
    expect(res.body.error).toBe("partner_role_required");
  });
});

describe("GET /tickets/direct-award/candidates — query-param validation", () => {
  it("returns 400 when workTypeId is missing", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?siteLocationId=11")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.work_type_id_required");
    expect(res.body.error).toBe("work_type_id_required");
  });

  it("returns 400 when workTypeId is not a number", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=abc&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.work_type_id_required");
    expect(res.body.error).toBe("work_type_id_required");
  });

  it("returns 400 when workTypeId is zero or negative", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=0&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.work_type_id_required");
    expect(res.body.error).toBe("work_type_id_required");
  });

  it("returns 400 when siteLocationId is missing", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.site_location_id_required");
    expect(res.body.error).toBe("site_location_id_required");
  });

  it("returns 400 when siteLocationId is not a number", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=foo")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.site_location_id_required");
    expect(res.body.error).toBe("site_location_id_required");
  });

  it("returns 400 when siteLocationId is zero or negative", async () => {
    // Parity with the workTypeId guard above — both ids must be positive
    // integers, otherwise the route would fall through to a no-op site
    // lookup and confusingly return 404 instead of failing fast.
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=0")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.site_location_id_required");
    expect(res.body.error).toBe("site_location_id_required");
  });
});

describe("GET /tickets/direct-award/candidates — site lookup guards", () => {
  it("returns 404 when the site does not exist", async () => {
    siteRow = null;
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
    expect(res.body.error).toBe("site_not_found");
  });

  it("returns 403 when the site belongs to a different partner", async () => {
    // The session is for partnerId=5; flipping siteRow.partnerId to 999
    // proves the route refuses to leak vendor candidates for sites the
    // calling partner does not own.
    siteRow = { ...siteRow, partnerId: 999 };
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("site.forbidden_not_owning_partner");
    expect(res.body.error).toBe("site_forbidden");
  });
});

describe("GET /tickets/direct-award/candidates — happy path tier mix", () => {
  it("returns approved → unapproved → pre_onboarded with tier from getVendorTier", async () => {
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);

    // Task #502 returns out-of-radius vendors as ineligible instead of
    // filtering them out. The eligible (in-radius + compliance-passed)
    // bucket is therefore still vendors 7 and 8, while 9 (in radius,
    // missing COI) and 10 (out of radius) are returned ineligible.
    const eligibleIds = res.body
      .filter((c: any) => c.eligible)
      .map((c: any) => c.id);
    expect(eligibleIds).toEqual([7, 8]);

    // Tier annotations must be exactly what getVendorTier returned for
    // each vendorId — proves the route does not hard-code a tier value.
    const tierById = Object.fromEntries(
      res.body.map((c: any) => [c.id, c.tier]),
    );
    expect(tierById[7]).toBe("approved");
    expect(tierById[8]).toBe("unapproved");
    expect(tierById[9]).toBe("pre_onboarded");
    expect(tierById[10]).toBe("approved");

    // Sort order: eligible vendors first, then within the eligible
    // bucket by tier (approved → unapproved → pre_onboarded). Vendors
    // 7 and 8 should land in that order at the head of the list.
    expect(res.body[0].id).toBe(7);
    expect(res.body[0].tier).toBe("approved");
    expect(res.body[1].id).toBe(8);
    expect(res.body[1].tier).toBe("unapproved");

    // Each row should carry the compliance verdict — approved/unapproved
    // are eligible (full COI + ein + future expiry), pre_onboarded is
    // not (missing COI). This guards against silently dropping the
    // ineligibility reason.
    const byId = Object.fromEntries(res.body.map((c: any) => [c.id, c]));
    expect(byId[7].eligible).toBe(true);
    expect(byId[8].eligible).toBe(true);
    expect(byId[9].eligible).toBe(false);
    expect(byId[9].ineligibleReason).toBeTruthy();
  });

  it("returns an empty array when no vendors match the work type", async () => {
    vendorRows = [];
    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /tickets/direct-award/candidates — Task #502 annotation", () => {
  it("returns out-of-radius vendors as ineligible with vendor_out_of_radius reason", async () => {
    vendorRows = [
      {
        id: 1,
        name: "Approved In Radius",
        latitude: 40.001,
        longitude: -74.001,
        operatingRadiusMiles: 50,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
      {
        id: 2,
        name: "Far Away",
        // ~700 miles north
        latitude: 50.0,
        longitude: -74.0,
        operatingRadiusMiles: 25,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
    ];
    vendorTierByVendorId = { 1: "approved", 2: "approved" };

    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(2);
    // Eligible vendor sorts first
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].eligible).toBe(true);
    expect(res.body[0].inRadius).toBe(true);
    expect(res.body[0].compliancePassed).toBe(true);
    expect(res.body[0].ineligibleReason).toBeNull();

    // Out-of-radius vendor is *included* but ineligible
    expect(res.body[1].id).toBe(2);
    expect(res.body[1].eligible).toBe(false);
    expect(res.body[1].inRadius).toBe(false);
    expect(res.body[1].compliancePassed).toBe(true);
    expect(res.body[1].ineligibleReason).toBe("vendor_out_of_radius");
    expect(res.body[1].ineligibleMessage).toMatch(/operating radius/i);
    expect(typeof res.body[1].distanceMiles).toBe("number");
  });

  it("returns vendors with no published service area as ineligible", async () => {
    vendorRows = [
      {
        id: 2,
        name: "Missing Geo",
        latitude: null,
        longitude: null,
        operatingRadiusMiles: null,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
    ];
    vendorTierByVendorId = { 2: "approved" };

    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].eligible).toBe(false);
    expect(res.body[0].inRadius).toBe(false);
    expect(res.body[0].distanceMiles).toBeNull();
    expect(res.body[0].ineligibleReason).toBe("vendor_no_operating_area");
  });

  it("returns vendors failing the compliance floor as ineligible with the structured reason", async () => {
    vendorRows = [
      {
        id: 1,
        name: "Missing COI",
        latitude: 40.001,
        longitude: -74.001,
        operatingRadiusMiles: 50,
        coiDocumentUrl: null,
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
      {
        id: 2,
        name: "Expired Insurance",
        latitude: 40.002,
        longitude: -74.002,
        operatingRadiusMiles: 50,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: pastIso,
        federalTaxId: "12-3456789",
      },
      {
        id: 3,
        name: "Missing Tax ID",
        latitude: 40.003,
        longitude: -74.003,
        operatingRadiusMiles: 50,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: null,
      },
    ];
    vendorTierByVendorId = { 1: "approved", 2: "approved", 3: "approved" };

    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(3);
    for (const c of res.body) {
      expect(c.inRadius).toBe(true);
      expect(c.compliancePassed).toBe(false);
      expect(c.eligible).toBe(false);
      expect(c.ineligibleMessage).toBeTruthy();
    }
    const reasonsById = Object.fromEntries(
      res.body.map((c: any) => [c.id, c.ineligibleReason]),
    );
    expect(reasonsById[1]).toBe("missing_coi_document");
    expect(reasonsById[2]).toBe("expired_insurance");
    expect(reasonsById[3]).toBe("missing_federal_tax_id");
  });

  it("sorts eligible vendors before ineligible ones", async () => {
    vendorRows = [
      // Eligible, but a partner-pre_onboarded tier — should still beat
      // an ineligible approved vendor in the final ordering.
      {
        id: 3,
        name: "Eligible Pre-onboarded",
        latitude: 40.001,
        longitude: -74.001,
        operatingRadiusMiles: 50,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
      // Ineligible (out of radius), approved tier.
      {
        id: 1,
        name: "Approved Far Away",
        latitude: 50.0,
        longitude: -74.0,
        operatingRadiusMiles: 1,
        coiDocumentUrl: "https://example.com/coi.pdf",
        insuranceExpirationDate: futureIso,
        federalTaxId: "12-3456789",
      },
    ];
    vendorTierByVendorId = { 1: "approved", 3: "pre_onboarded" };

    const res = await request(app)
      .get("/api/tickets/direct-award/candidates?workTypeId=22&siteLocationId=11")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(2);
    // Eligible vendor first regardless of tier
    expect(res.body[0].id).toBe(3);
    expect(res.body[0].eligible).toBe(true);
    expect(res.body[1].id).toBe(1);
    expect(res.body[1].eligible).toBe(false);
  });
});
