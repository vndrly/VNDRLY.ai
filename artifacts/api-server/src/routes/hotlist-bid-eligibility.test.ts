import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for the Task #847 bid-list eligibility annotation.
//
// `GET /api/hotlist/jobs/:id` joins each bid's vendor row and runs the
// same gating logic the Direct Award candidate dropdown uses
// (lib/vendor-tier.ts → checkComplianceFloor) so the partner UI can
// grey out and explain bidders that would be rejected at award time.
//
// The compliance-floor math itself is unit-tested in
// lib/vendor-tier.test.ts; here we trust the helper (`checkComplianceFloor`
// is imported from the real module) and focus on the route's
// per-bid annotation, including the radius branch and the strip of
// the bare vendor lookup columns.

const cookieFor = (s: object) => buildTestCookie(s);

let jobRow: any = null;
let bidRows: any[] = [];

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

vi.mock("../lib/hotlist-rate-limit", () => ({
  enforceHotlistRateLimit: vi.fn(async () => true),
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  // GET /hotlist/jobs/:id reads in this order:
  //   0: hotlistJobsTable .where(eq(id, …))           → [job]
  //   1: hotlistBidsTable .leftJoin(...)…orderBy(...) → bidRows
  let selectStep = 0;
  const db: any = {
    select: () => {
      const seq = [
        () => makeChain([jobRow].filter(Boolean)),
        () => makeChain(bidRows),
      ];
      const fn = seq[selectStep] ?? (() => makeChain([]));
      selectStep += 1;
      return fn();
    },
    selectDistinct: () => makeChain([]),
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
    hotlistJobsTable: tableTag("hotlistJobs"),
    hotlistBidsTable: tableTag("hotlistBids"),
    vendorsTable: tableTag("vendors"),
    partnersTable: tableTag("partners"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    siteLocationsTable: tableTag("siteLocations"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    workTypesTable: tableTag("workTypes"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  findVendorUserIds: vi.fn(async () => [] as number[]),
  findPartnerUserIds: vi.fn(async () => [] as number[]),
}));

let app: express.Express;

const partnerCookie = cookieFor({
  userId: 1,
  role: "partner",
  vendorId: null,
  partnerId: 5,
});

const futureIso = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)
  .toISOString()
  .slice(0, 10);
const pastIso = new Date(Date.now() - 1000 * 60 * 60 * 24)
  .toISOString()
  .slice(0, 10);

beforeEach(async () => {
  // Job belongs to the calling partner (partnerId=5) and is geocoded
  // so the radius math has a baseline to anchor on.
  jobRow = {
    id: 42,
    partnerId: 5,
    title: "Roof tarp",
    description: null,
    locationAddress: "123 Main St",
    latitude: 40.0,
    longitude: -74.0,
    deadline: null,
    estimatedDurationDays: null,
    status: "open",
    awardedBidId: null,
    awardedVendorId: null,
    convertedTicketId: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  // Five bids exercising every annotation branch the route emits.
  bidRows = [
    {
      // Approved + in radius + compliance OK → eligible.
      id: 100,
      jobId: 42,
      vendorId: 7,
      amountUsd: "500.00",
      etaDays: 1,
      notes: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      vendorName: "Acme Roofing",
      vendorLatitude: 40.01,
      vendorLongitude: -74.01,
      vendorOperatingRadiusMiles: 50,
      vendorCoiDocumentUrl: "https://example.com/coi-acme.pdf",
      vendorInsuranceExpirationDate: futureIso,
      vendorFederalTaxId: "12-3456789",
      relationshipStatus: "approved",
    },
    {
      // Approved relationship but vendor has no published service area.
      // Should land as ineligible with reason vendor_no_operating_area
      // *before* compliance is even checked.
      id: 101,
      jobId: 42,
      vendorId: 8,
      amountUsd: "600.00",
      etaDays: 2,
      notes: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      vendorName: "Beta Builders",
      vendorLatitude: null,
      vendorLongitude: null,
      vendorOperatingRadiusMiles: null,
      vendorCoiDocumentUrl: "https://example.com/coi-beta.pdf",
      vendorInsuranceExpirationDate: futureIso,
      vendorFederalTaxId: "98-7654321",
      relationshipStatus: "approved",
    },
    {
      // Approved relationship + has service area but is far enough away
      // that the job sits outside vendor's radius → out_of_radius.
      id: 102,
      jobId: 42,
      vendorId: 9,
      amountUsd: "700.00",
      etaDays: 3,
      notes: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      vendorName: "Charlie Distant",
      // ~700 mi north of the job
      vendorLatitude: 50.0,
      vendorLongitude: -74.0,
      vendorOperatingRadiusMiles: 25,
      vendorCoiDocumentUrl: "https://example.com/coi-charlie.pdf",
      vendorInsuranceExpirationDate: futureIso,
      vendorFederalTaxId: "33-3333333",
      relationshipStatus: "approved",
    },
    {
      // Approved relationship + in radius + insurance expired → expired_insurance.
      // Proves the compliance branch fires only when the radius branch
      // does NOT, and that the structured floor reason is preserved.
      id: 103,
      jobId: 42,
      vendorId: 10,
      amountUsd: "800.00",
      etaDays: 4,
      notes: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      vendorName: "Delta Drainage",
      vendorLatitude: 40.02,
      vendorLongitude: -74.02,
      vendorOperatingRadiusMiles: 50,
      vendorCoiDocumentUrl: "https://example.com/coi-delta.pdf",
      vendorInsuranceExpirationDate: pastIso,
      vendorFederalTaxId: "44-4444444",
      relationshipStatus: "approved",
    },
    {
      // Approved relationship + in radius + missing COI → missing_coi_document.
      id: 104,
      jobId: 42,
      vendorId: 11,
      amountUsd: "900.00",
      etaDays: 5,
      notes: null,
      status: "pending",
      createdAt: new Date().toISOString(),
      vendorName: "Echo Electrical",
      vendorLatitude: 40.03,
      vendorLongitude: -74.03,
      vendorOperatingRadiusMiles: 50,
      vendorCoiDocumentUrl: null,
      vendorInsuranceExpirationDate: futureIso,
      vendorFederalTaxId: "55-5555555",
      relationshipStatus: "approved",
    },
  ];
  vi.resetModules();
  const router = (await import("./hotlist")).default;
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

describe("GET /hotlist/jobs/:id — Task #847 bid eligibility annotation", () => {
  it("annotates each bid with distance, radius status, and compliance verdict", async () => {
    const res = await request(app)
      .get("/api/hotlist/jobs/42")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);

    const byId: Record<number, any> = Object.fromEntries(
      res.body.bids.map((b: any) => [b.id, b]),
    );

    // Eligible bid — every gate passes.
    expect(byId[100].eligible).toBe(true);
    expect(byId[100].inRadius).toBe(true);
    expect(byId[100].compliancePassed).toBe(true);
    expect(byId[100].ineligibleReason).toBeNull();
    expect(byId[100].ineligibleMessage).toBeNull();
    expect(typeof byId[100].distanceMiles).toBe("number");
    expect(byId[100].distanceMiles).toBeLessThan(2); // ~0.9 mi at the equator-ish lat
    expect(byId[100].operatingRadiusMiles).toBe(50);

    // No service area — radius branch wins, distance stays null.
    expect(byId[101].eligible).toBe(false);
    expect(byId[101].inRadius).toBe(false);
    expect(byId[101].distanceMiles).toBeNull();
    expect(byId[101].operatingRadiusMiles).toBeNull();
    expect(byId[101].ineligibleReason).toBe("vendor_no_operating_area");
    expect(byId[101].ineligibleMessage).toMatch(/operating area/i);

    // Out of radius — distance is computed but inRadius:false.
    expect(byId[102].eligible).toBe(false);
    expect(byId[102].inRadius).toBe(false);
    expect(byId[102].distanceMiles).toBeGreaterThan(100);
    expect(byId[102].operatingRadiusMiles).toBe(25);
    expect(byId[102].ineligibleReason).toBe("vendor_out_of_radius");
    expect(byId[102].ineligibleMessage).toMatch(/operating radius/i);

    // In radius but expired insurance — compliance branch.
    expect(byId[103].eligible).toBe(false);
    expect(byId[103].inRadius).toBe(true);
    expect(byId[103].compliancePassed).toBe(false);
    expect(byId[103].ineligibleReason).toBe("expired_insurance");
    expect(byId[103].ineligibleMessage).toMatch(/expired/i);

    // In radius but missing COI — compliance branch.
    expect(byId[104].eligible).toBe(false);
    expect(byId[104].inRadius).toBe(true);
    expect(byId[104].compliancePassed).toBe(false);
    expect(byId[104].ineligibleReason).toBe("missing_coi_document");
  });

  it("does not leak the bare vendor lookup columns into the bid response", async () => {
    // The route joins vendors only to compute the annotation; the raw
    // vendor coordinates / COI URL / insurance date / federal tax id
    // are sensitive operational data and must NOT round-trip back to
    // the partner UI as bid fields.
    const res = await request(app)
      .get("/api/hotlist/jobs/42")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    for (const b of res.body.bids) {
      expect(b).not.toHaveProperty("vendorLatitude");
      expect(b).not.toHaveProperty("vendorLongitude");
      expect(b).not.toHaveProperty("vendorCoiDocumentUrl");
      expect(b).not.toHaveProperty("vendorInsuranceExpirationDate");
      expect(b).not.toHaveProperty("vendorFederalTaxId");
      // operatingRadiusMiles IS exposed — the partner needs it for the
      // "radius covers X mi" tooltip — under its annotation name, not
      // the joined column name.
      expect(b).not.toHaveProperty("vendorOperatingRadiusMiles");
    }
  });

  it("falls back to job_not_geocoded when the job has no lat/lng", async () => {
    // A partner can post a job whose street address fails to geocode
    // (Nominatim down, rural address). Bids placed against such a job
    // — historically possible if a vendor's bid endpoint was bypassed
    // — should NOT silently appear eligible. The annotation reports
    // job_not_geocoded so the partner sees why distance is unknown.
    jobRow = { ...jobRow, latitude: null, longitude: null };
    const res = await request(app)
      .get("/api/hotlist/jobs/42")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    const byId: Record<number, any> = Object.fromEntries(
      res.body.bids.map((b: any) => [b.id, b]),
    );
    // Vendor 100 has a service area but the job lacks coords → job_not_geocoded.
    expect(byId[100].eligible).toBe(false);
    expect(byId[100].inRadius).toBe(false);
    expect(byId[100].distanceMiles).toBeNull();
    expect(byId[100].ineligibleReason).toBe("job_not_geocoded");
    // Vendor 101 has neither service area nor radius — the
    // vendor-side branch still wins (it's checked first).
    expect(byId[101].ineligibleReason).toBe("vendor_no_operating_area");
  });

  it("preserves the includeUnaffiliated/totalBidCount/unaffiliatedCount contract", async () => {
    // Default (no ?includeUnaffiliated) hides bids whose
    // relationshipStatus is neither "preferred" nor "approved" but
    // still counts them in totalBidCount + unaffiliatedCount, just
    // like the pre-Task-#847 contract.
    bidRows = [
      { ...bidRows[0], relationshipStatus: "approved" },
      { ...bidRows[1], id: 201, relationshipStatus: null },
      { ...bidRows[2], id: 202, relationshipStatus: null },
    ];
    const res = await request(app)
      .get("/api/hotlist/jobs/42")
      .set("Cookie", partnerCookie);
    expectStatus(res, 200);
    expect(res.body.bids.length).toBe(1);
    expect(res.body.totalBidCount).toBe(3);
    expect(res.body.unaffiliatedCount).toBe(2);
    // Annotation must apply equally to the unaffiliated bids when
    // they're explicitly opted in — they aren't getting silently
    // filtered out of the eligibility calculation. The DB mock walks
    // through a per-test sequence, so reset it before issuing the
    // second supertest request against the same app.
    const db = (await import("@workspace/db")).db as any;
    if (typeof db.__resetSelectStep === "function") db.__resetSelectStep();
    const res2 = await request(app)
      .get("/api/hotlist/jobs/42?includeUnaffiliated=1")
      .set("Cookie", partnerCookie);
    expectStatus(res2, 200);
    expect(res2.body.bids.length).toBe(3);
    expect(res2.body.unaffiliatedCount).toBe(0);
    for (const b of res2.body.bids) {
      expect(b).toHaveProperty("eligible");
      expect(b).toHaveProperty("ineligibleReason");
    }
  });
});
