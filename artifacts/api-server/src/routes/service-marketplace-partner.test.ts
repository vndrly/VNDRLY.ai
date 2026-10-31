import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { subjectFingerprint } from "../services/service-matching/candidates";
import { createServiceMarketplaceRouter } from "./serviceMarketplace";
import type { PartnerMarketplaceStore } from "../services/marketplace/partner-store";
import { mappingMatchesSavedSubject } from "../services/marketplace/eligibility";
import {
  SearchPartnerMarketplaceVendorsResponse,
  GetPartnerMarketplaceVendorResponse,
  GetPartnerMarketplaceVendorQueryParams,
} from "@workspace/api-zod";

const now = new Date("2026-10-18T00:00:00Z");
const subject = {
  subjectType: "partner_work_type" as const,
  subjectId: 21,
  name: "Gatekeeping",
  description: null,
  category: "Security",
};
const capSubject = {
  subjectType: "vendor_capability" as const,
  subjectId: 7,
  name: "Gate crews",
  description: null,
};
const mapping = (s: typeof subject | typeof capSubject) => ({
  canonicalServiceId: 5,
  status: "active",
  supersededAt: null,
  explanation: "Controlled entry",
  evidence: { serviceMatching: { subjectFingerprint: subjectFingerprint(s) } },
});
const cookie = buildTestCookie({
  userId: 2,
  role: "partner",
  partnerId: 9,
  membershipRole: "member",
  activeMembershipId: 4,
});
let app: express.Express;
let rows: any[];
let authority: boolean;
let loaded: number;
let context: any;
const requestQuote = vi.fn(async () => {});
beforeEach(() => {
  requestQuote.mockClear();
  authority = true;
  loaded = 0;
  context = {
    partnerId: 9,
    workType: { ...subject, id: 21, partnerId: 9 },
    site: { id: 8, partnerId: 9, latitude: 35, longitude: -97 },
    demandMapping: mapping(subject),
    canonicalServiceActive: true,
    requiredCredentials: [],
  };
  rows = [
    {
      vendorId: 3,
      vendorName: "MidCon",
      capability: {
        id: 7,
        vendorId: 3,
        name: "Gate crews",
        description: null,
        active: true,
        capacity: 2,
      },
      capabilityMapping: mapping(capSubject),
      companyActive: true,
      offer: {
        id: 12,
        vendorCapabilityId: 7,
        partnerId: 9,
        workTypeId: 21,
        unitPrice: "75.00",
        unit: "hour",
        currency: "USD",
        active: true,
        capacity: 2,
        availability: { available: true },
        effectiveFrom: new Date("2026-01-01"),
        effectiveUntil: null,
        commercialConditions: "Two hour minimum",
        notes: "INTERNAL-NOTE",
        rateComponents: { secret: "PRIVATE" },
      },
      serviceAreas: [
        {
          vendorId: 3,
          vendorCapabilityId: null,
          latitude: 35,
          longitude: -97,
          radiusMiles: "100",
          active: true,
          verifiedAt: new Date("2026-01-01"),
          effectiveFrom: new Date("2026-01-01"),
          effectiveUntil: null,
        },
      ],
      complianceCurrent: true,
      relationshipStatus: null,
      currentCredentials: [],
      qualifiedWorkerCount: 2,
      rating: null,
      reviewCount: 0,
      safety: null,
      completedJobs: 0,
      onTimeRate: null,
      priorPartnerJobs: 0,
      privateNotes: "SECRET",
      hiddenBudget: 999,
    },
  ];
  const partnerStore: PartnerMarketplaceStore = {
    authorize: async () => authority,
    loadContext: async (partnerId, workTypeId, siteId) =>
      partnerId === 9 && workTypeId === 21 && siteId === 8 ? context : null,
    listCandidates: async () => {
      loaded++;
      return rows;
    },
  };
  app = express()
    .use(cookieParser())
    .use(express.json())
    .use(
      "/api",
      createServiceMarketplaceRouter({ partnerStore, requestQuote, now: () => now, isEnabled: async () => true }),
    );
});
const path = "/api/service-marketplace/partners/9/work-types/21/vendors";
describe("partner marketplace discovery", () => {
  it("discovers a service-matched vendor without partner pricing and supports exact detail without a rate ID", async () => {
    rows[0].offer = null;
    const result = await request(app).get(path + "?siteId=8").set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({ offer: null, quoteRequired: true, offerable: false, eligibility: { eligible: true, facts: { availableCapacity: 2 } } });
    expect(SearchPartnerMarketplaceVendorsResponse.safeParse(result.body).success).toBe(true);
    const detail = await request(app).get(path + "/3?siteId=8&vendorCapabilityId=7").set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(result.body.items[0]);
  });
  it("keeps a matched vendor visible when pricing expires without exposing obsolete terms", async () => {
    rows[0].offer.effectiveUntil = now;
    const result = await request(app).get(path + "?siteId=8").set("Cookie", cookie);
    expect(result.body.items[0]).toMatchObject({ offer: null, quoteRequired: true, offerable: false });
  });
  it("delivers a quote request only for an authorized current eligible match", async () => {
    rows[0].offer = null;
    const body = { siteId: 8, vendorCapabilityId: 7, requestedCapacity: 1, scope: "Gatekeeping next Monday" };
    const result = await request(app).post(path + "/3/quote-requests").set("Cookie", cookie).send(body);
    expect(result.status).toBe(202);
    expect(requestQuote).toHaveBeenCalledWith(expect.objectContaining({ partnerId: 9, vendorId: 3, capabilityId: 7, scope: body.scope }));
    requestQuote.mockClear();
    rows[0].relationshipStatus = "revoked";
    expect((await request(app).post(path + "/3/quote-requests").set("Cookie", cookie).send(body)).status).toBe(409);
    authority = false;
    expect((await request(app).post(path + "/3/quote-requests").set("Cookie", cookie).send(body)).status).toBe(403);
    expect(requestQuote).not.toHaveBeenCalled();
  });

  it("returns only approved facts and the selected partner's terms, with canonical detail readback", async () => {
    expect(mappingMatchesSavedSubject(context.demandMapping, subject)).toBe(
      true,
    );
    expect(
      mappingMatchesSavedSubject(rows[0].capabilityMapping, capSubject),
    ).toBe(true);
    const search = await request(app)
      .get(path + "?siteId=8")
      .set("Cookie", cookie);
    expect(search.status).toBe(200);
    expect(
      SearchPartnerMarketplaceVendorsResponse.safeParse(search.body).success,
    ).toBe(true);
    expect(loaded).toBe(1);
    expect(search.body).toMatchObject({ total: 1, offset: 0, limit: 50 });
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0]).toMatchObject({
      vendorId: 3,
      rating: null,
      safety: null,
      relationshipStatus: null,
      offerable: true,
      offer: { unitPrice: 75, commercialConditions: "Two hour minimum" },
      eligibility: { facts: { distanceMiles: 0, radiusMiles: 100 } },
    });
    expect(JSON.stringify(search.body)).not.toMatch(
      /SECRET|INTERNAL-NOTE|PRIVATE|hiddenBudget|internalEvidence/,
    );
    const detail = await request(app)
      .get(
        path +
          "/3?siteId=8&vendorCapabilityId=7&vendorPartnerServiceOfferId=12",
      )
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(search.body.items[0]);
    expect(
      GetPartnerMarketplaceVendorResponse.safeParse(detail.body).success,
    ).toBe(true);
  });
  it("reads the exact lower-ranked capability and rate rather than substituting the vendor's first offer", async () => {
    const alternative = structuredClone(rows[0]);
    alternative.capability = {
      ...alternative.capability,
      id: 8,
      name: "Surge gate crews",
    };
    alternative.capabilityMapping = mapping({
      ...capSubject,
      subjectId: 8,
      name: "Surge gate crews",
    });
    alternative.offer = {
      ...alternative.offer,
      id: 13,
      vendorCapabilityId: 8,
      unitPrice: "99.00",
    };
    rows.push(alternative);
    const result = await request(app)
      .get(
        path +
          "/3?siteId=8&sort=price&vendorCapabilityId=8&vendorPartnerServiceOfferId=13",
      )
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      vendorId: 3,
      capabilityId: 8,
      capabilityName: "Surge gate crews",
      offer: { id: 13, unitPrice: 99 },
    });
    expect(
      GetPartnerMarketplaceVendorResponse.safeParse(result.body).success,
    ).toBe(true);
  });
  it("requires positive exact capability and commercial-offer identities in the generated and runtime contracts", async () => {
    for (const query of [
      { siteId: "8" },
      { siteId: "8", vendorPartnerServiceOfferId: "12" },
      {
        siteId: "8",
        vendorCapabilityId: "0",
        vendorPartnerServiceOfferId: "12",
      },
      {
        siteId: "8",
        vendorCapabilityId: "7",
        vendorPartnerServiceOfferId: "-1",
      },
    ]) {
      expect(
        GetPartnerMarketplaceVendorQueryParams.safeParse(query).success,
      ).toBe(false);
      expect(
        (
          await request(app)
            .get(
              path +
                "/3?" +
                new URLSearchParams(query as Record<string, string>),
            )
            .set("Cookie", cookie)
        ).status,
      ).toBe(400);
    }
    expect(loaded).toBe(0);
  });
  it("never reads an exact offer under an unrelated vendor, partner, capability or work type", async () => {
    const query =
      "?siteId=8&vendorCapabilityId=7&vendorPartnerServiceOfferId=12";
    for (const target of [
      path + "/4" + query,
      path +
        "/3" +
        query.replace("vendorCapabilityId=7", "vendorCapabilityId=8"),
      path +
        "/3" +
        query.replace(
          "vendorPartnerServiceOfferId=12",
          "vendorPartnerServiceOfferId=13",
        ),
    ]) {
      expect(
        (await request(app).get(target).set("Cookie", cookie)).status,
      ).toBe(404);
    }
    rows[0].offer.partnerId = 99;
    expect(
      (
        await request(app)
          .get(path + "/3" + query)
          .set("Cookie", cookie)
      ).status,
    ).toBe(404);
    rows[0].offer.partnerId = 9;
    rows[0].offer.workTypeId = 99;
    expect(
      (
        await request(app)
          .get(path + "/3" + query)
          .set("Cookie", cookie)
      ).status,
    ).toBe(404);
  });
  it("excludes stale mappings and unrelated partner offers before ranking", async () => {
    rows.push({
      ...rows[0],
      vendorId: 6,
      capability: {
        ...rows[0].capability,
        id: 8,
        vendorId: 6,
        name: "Changed meaning",
      },
    });
    rows.push({
      ...rows[0],
      vendorId: 7,
      capability: { ...rows[0].capability, vendorId: 7 },
      offer: { ...rows[0].offer, partnerId: 99, unitPrice: "1.00" },
    });
    const result = await request(app)
      .get(path + "?siteId=8&sort=price")
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.items.map((x: any) => x.vendorId)).toEqual([3, 7]);
    expect(result.body.items[1]).toMatchObject({ offer: null, quoteRequired: true, offerable: false });
    context.workType.name = "Changed demand";
    const stale = await request(app)
      .get(path + "?siteId=8")
      .set("Cookie", cookie);
    expect(stale.status).toBe(200);
    expect(stale.body.items).toEqual([]);
  });
  it("keeps out-of-area matches visible with offer disabled and independent eligibility reasons", async () => {
    rows[0].serviceAreas[0].latitude = 38;
    const result = await request(app)
      .get(path + "?siteId=8")
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({
      offerable: false,
      eligibility: { reasonCodes: ["OUT_OF_SERVICE_AREA"] },
    });
    expect(
      result.body.items[0].eligibility.facts.distanceMiles,
    ).toBeGreaterThan(200);
  });
  it("enforces saved worker credential capacity before ranking", async () => {
    context.requiredCredentials = ["H2S"];
    rows[0].qualifiedWorkerCount = 1;
    rows[0].currentCredentials = ["H2S"];
    const result = await request(app)
      .get(path + "?siteId=8&requestedCapacity=2")
      .set("Cookie", cookie);
    expect(result.body.items[0]).toMatchObject({
      offerable: false,
      eligibility: {
        reasonCodes: ["INSUFFICIENT_CAPACITY"],
        facts: { availableCapacity: 1 },
      },
    });
  });
  it("applies partner weights to the whole validated set before pagination", async () => {
    const other = structuredClone(rows[0]);
    other.vendorId = 4;
    other.vendorName = "Another vendor";
    other.capability = { ...other.capability, id: 8, vendorId: 4 };
    other.capabilityMapping = mapping({ ...capSubject, subjectId: 8 });
    other.offer = {
      ...other.offer,
      id: 13,
      vendorCapabilityId: 8,
      unitPrice: "25.00",
    };
    other.serviceAreas[0].vendorId = 4;
    other.serviceAreas[0].latitude = 35.1;
    rows.push(other);
    const cheap = await request(app)
      .get(path + "?siteId=8&sort=price&limit=1")
      .set("Cookie", cookie);
    expect(cheap.body).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(cheap.body.items.map((x: any) => x.vendorId)).toEqual([4]);
    const weighted = await request(app)
      .get(path + "?siteId=8&priceWeight=0&distanceWeight=100&limit=1")
      .set("Cookie", cookie);
    expect(weighted.body.items.map((x: any) => x.vendorId)).toEqual([3]);
    const next = await request(app)
      .get(path + "?siteId=8&sort=price&offset=1&limit=1")
      .set("Cookie", cookie);
    expect(next.body.items.map((x: any) => x.vendorId)).toEqual([3]);
  });
  it("does not require prior relationship approval and still blocks direct compliance failures", async () => {
    for (const relationshipStatus of [null, "pending_review", "approved"]) {
      rows[0].relationshipStatus = relationshipStatus;
      const result = await request(app)
        .get(path + "?siteId=8")
        .set("Cookie", cookie);
      expect(result.body.items[0]).toMatchObject({
        offerable: true,
        relationshipStatus,
      });
    }
    for (const relationshipStatus of ["revoked", "rejected", "suspended"]) {
      rows[0].relationshipStatus = relationshipStatus;
      const result = await request(app).get(path + "?siteId=8").set("Cookie", cookie);
      expect(result.body.items[0]).toMatchObject({
        offerable: false, relationshipStatus,
        eligibility: { reasonCodes: ["RELATIONSHIP_RESTRICTED"] },
      });
    }
    rows[0].relationshipStatus = null;
    rows[0].complianceCurrent = false;
    const advisory = await request(app)
      .get(path + "?siteId=8")
      .set("Cookie", cookie);
    expect(advisory.body.items[0]).toMatchObject({
      offerable: true,
      eligibility: { reasonCodes: ["COMPLIANCE_STALE"] },
    });
  });
  it("checks active partner, persisted authority, owned work type and site before loading vendors", async () => {
    for (const other of [
      undefined,
      buildTestCookie({
        userId: 2,
        role: "partner",
        partnerId: 10,
        activeMembershipId: 4,
      }),
      buildTestCookie({
        userId: 2,
        role: "partner",
        partnerId: 9,
        vendorId: 3,
        activeMembershipId: 4,
      }),
      buildTestCookie({ userId: 2, role: "vendor", vendorId: 3 }),
      buildTestCookie({ userId: 2, role: "partner", partnerId: 9 }),
    ]) {
      const call = request(app).get(path + "?siteId=8");
      if (other) call.set("Cookie", other);
      expect((await call).status).toBe(403);
    }
    authority = false;
    expect(
      (
        await request(app)
          .get(path + "?siteId=8")
          .set("Cookie", cookie)
      ).status,
    ).toBe(403);
    authority = true;
    expect(
      (
        await request(app)
          .get(path + "?siteId=99")
          .set("Cookie", cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(path.replace("21", "99") + "?siteId=8")
          .set("Cookie", cookie)
      ).status,
    ).toBe(404);
    expect(loaded).toBe(0);
  });
  it("rejects client eligibility, rating and coordinate injection and validates sort controls", async () => {
    for (const query of [
      "siteId=8&complianceCurrent=true",
      "siteId=8&latitude=35",
      "siteId=8&rating=5",
      "siteId=8&sort=winner",
      "siteId=8&requestedCapacity=0",
      "siteId=8&priceWeight=-1",
    ]) {
      expect(
        (
          await request(app)
            .get(path + "?" + query)
            .set("Cookie", cookie)
        ).status,
      ).toBe(400);
    }
    expect(loaded).toBe(0);
  });
  it("keeps archived, superseded, future and ended commercial matches out of discovery", async () => {
    const original = structuredClone(rows[0]);
    for (const mutation of [
      (row: any) => {
        row.capabilityMapping.supersededAt = now;
      },
      (row: any) => {
        row.capabilityMapping.status = "review_required";
      },
      (row: any) => {
        row.capability.active = false;
      },
    ]) {
      rows = [structuredClone(original)];
      mutation(rows[0]);
      const result = await request(app)
        .get(path + "?siteId=8")
        .set("Cookie", cookie);
      expect(result.status).toBe(200);
      expect(result.body.items).toEqual([]);
    }
    rows = [original];
    context.canonicalServiceActive = false;
    expect(
      (
        await request(app)
          .get(path + "?siteId=8")
          .set("Cookie", cookie)
      ).body.items,
    ).toEqual([]);
  });
  it("does not let missing site coordinates or unavailability become offerable", async () => {
    context.site.latitude = null;
    rows[0].offer.availability.available = false;
    const result = await request(app)
      .get(path + "?siteId=8")
      .set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({
      offerable: false,
      eligibility: {
        reasonCodes: ["SITE_COORDINATES_INVALID", "UNAVAILABLE"],
        facts: { distanceMiles: null },
      },
    });
  });
});
