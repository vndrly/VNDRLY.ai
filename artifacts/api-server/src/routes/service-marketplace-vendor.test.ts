import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import {
  createServiceMarketplaceRouter,
  type VendorMarketplaceStore,
} from "./serviceMarketplace";
import {
  CreateVendorMarketplaceCapabilityBody,
  ListVendorMarketplaceCapabilitiesResponse,
  PreviewVendorMarketplaceCapabilityResponse,
} from "@workspace/api-zod";

const vendor = buildTestCookie({
  userId: 7,
  role: "vendor",
  vendorId: 3,
  membershipRole: "admin",
  activeMembershipId: 4,
});
let app: express.Express;
let records: any[];
let authority: boolean;
let classifications: number;
let previews: { name: string; description?: string | null }[];
let savedOffer: any;
let clearedAreas: { vendorId: number; capabilityId: number; actor: number }[];
const capability = {
  id: 7,
  vendorId: 3,
  name: "Gate Services",
  description: "Visitor logs",
  defaultUnit: "hour",
  defaultRateCard: null,
  capacity: 2,
  qualifications: null,
  evidence: null,
  active: true,
  createdById: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const mapping = {
  canonicalServiceId: 5,
  status: "active",
  supersededAt: null,
  explanation: "Controlled entry",
};
beforeEach(() => {
  records = [structuredClone(capability)];
  authority = true;
  classifications = 0;
  previews = [];
  savedOffer = null;
  clearedAreas = [];
  const store: VendorMarketplaceStore = {
    authorize: async () => authority,
    listCapabilities: async () => records,
    getCapability: async (vendorId, id) =>
      records.find((x) => x.id === id && x.vendorId === vendorId) ?? null,
    saveCapability: async (vendorId, id, body) => {
      const row = { ...capability, ...body, vendorId, id: id ?? 8 };
      records = records.filter((x) => x.id !== row.id).concat(row);
      return row;
    },
    listAreas: async () => [],
    countMatchingDemand: async () => 2,
    clearAreaOverride: async (vendorId, capabilityId, actor) => {
      clearedAreas.push({ vendorId, capabilityId, actor });
    },
    saveArea: async (_vendorId, body) => ({
      id: 1,
      vendorId: 3,
      address: "Saved base",
      latitude: 35,
      longitude: -97,
      coordinateProvenance: "vendor_geocoded",
      verifiedAt: new Date(),
      effectiveFrom: new Date(),
      effectiveUntil: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...body,
      radiusMiles: String(body.radiusMiles),
    }),
    listRates: async () => (savedOffer ? [savedOffer] : []),
    saveRate: async (_vendorId, body) => {
      savedOffer = {
        id: 1,
        ...body,
        partnerId: 9,
        version: 1,
        unitPrice: String(body.unitPrice),
        createdById: 7,
        updatedById: 7,
      };
      return savedOffer;
    },
    getRateTarget: async (_vendorId, capabilityId, workTypeId) =>
      capabilityId === 7 && workTypeId === 21
        ? {
            partnerId: 9,
            capabilityMapping: mapping,
            demandMapping: mapping,
            canonicalServiceActive: true,
          }
        : null,
    listDemand: async () => [
      {
        partnerId: 9,
        partnerName: "Flywheel",
        workTypeId: 21,
        name: "Gatekeeping",
        category: "Security",
        description: "Visitor logging",
        requiredCertifications: ["H2S"],
        locations: [{ state: "OK", approximateSiteCount: 10 }],
        approximateDemand: 10,
        capabilityId: 7,
        ownOffer: savedOffer,
        eligibility: {
          eligible: false,
          reasonCodes: ["OFFER_INACTIVE"],
          facts: {
            distanceMiles: null,
            radiusMiles: null,
            availableCapacity: 0,
            requiredCapacity: 1,
            missingCredentials: [],
          },
          internalEvidence: { competitor: "Secret", budget: 1000 },
        },
        privateNotes: "secret",
      } as never,
    ],
  };
  app = express()
    .use(cookieParser())
    .use(express.json())
    .use(
      "/api",
      createServiceMarketplaceRouter({
        isEnabled: async () => true,
        store,
        previewCapability: async (input) => {
          previews.push(input);
          return {
            provisional: true,
            status: "matched",
            canonicalServiceId: 5,
            canonicalServiceName: "Gate and perimeter security",
            confidence: 0.98,
            explanation: "Controlled entry",
            matchingPartnerCount: 2,
          };
        },
        classifyCapability: async () => {
          classifications++;
        },
      }),
    );
});

describe("vendor marketplace", () => {
  it("previews unsaved wording with a matching count without creating catalog or commercial records", async () => {
    const result = await request(app)
      .post("/api/service-marketplace/vendors/3/capabilities/preview")
      .set("Cookie", vendor)
      .send({ name: "Gate Services", description: "Visitor logs" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      provisional: true,
      canonicalServiceName: "Gate and perimeter security",
      matchingPartnerCount: 2,
    });
    expect(
      PreviewVendorMarketplaceCapabilityResponse.safeParse(result.body).success,
    ).toBe(true);
    expect(result.body).not.toHaveProperty("subjectId");
    expect(result.body).not.toHaveProperty("evidence");
    expect(previews).toEqual([
      { name: "Gate Services", description: "Visitor logs" },
    ]);
    expect(records).toHaveLength(1);
    expect(savedOffer).toBeNull();
    expect(classifications).toBe(0);
    const injected = await request(app)
      .post("/api/service-marketplace/vendors/3/capabilities/preview")
      .set("Cookie", vendor)
      .send({ name: "Gate", canonicalServiceId: 5, vendorId: 99 });
    expect(injected.status).toBe(400);
    expect(previews).toHaveLength(1);
  });
  it("returns an owned capability to company inheritance and keeps the clear operation idempotent", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await request(app)
        .delete(
          "/api/service-marketplace/vendors/3/service-areas/capabilities/7",
        )
        .set("Cookie", vendor);
      expect(result.status).toBe(204);
    }
    expect(clearedAreas).toEqual([
      { vendorId: 3, capabilityId: 7, actor: 7 },
      { vendorId: 3, capabilityId: 7, actor: 7 },
    ]);
    const other = await request(app)
      .delete(
        "/api/service-marketplace/vendors/3/service-areas/capabilities/999",
      )
      .set("Cookie", vendor);
    expect(other.status).toBe(404);
    expect(clearedAreas).toHaveLength(2);
    expect(
      (
        await request(app)
          .delete(
            "/api/service-marketplace/vendors/3/service-areas/capabilities/0",
          )
          .set("Cookie", vendor)
      ).status,
    ).toBe(400);
  });
  it.each([
    undefined,
    buildTestCookie({ userId: 7, role: "partner", partnerId: 9 }),
    buildTestCookie({ userId: 7, role: "vendor", vendorId: 4 }),
    buildTestCookie({
      userId: 7,
      role: "vendor",
      vendorId: 3,
      membershipRole: "member",
    }),
    buildTestCookie({ userId: 7, role: "field_employee", vendorId: 3 }),
  ])(
    "fails closed across reads and writes for other scopes",
    async (cookie) => {
      for (const [method, path] of [
        ["get", "capabilities"],
        ["post", "capabilities"],
        ["post", "capabilities/preview"],
        ["patch", "capabilities/7"],
        ["get", "service-areas"],
        ["put", "service-areas"],
        ["delete", "service-areas/capabilities/7"],
        ["get", "matching-demand"],
        ["get", "partner-rates"],
        ["put", "partner-rates"],
      ] as const) {
        const call = request(app)[method](
          `/api/service-marketplace/vendors/3/${path}`,
        );
        if (cookie) call.set("Cookie", cookie);
        expect((await call.send({})).status).toBe(403);
      }
      expect(records).toHaveLength(1);
    },
  );
  it("rechecks active authority and supports an identified system admin", async () => {
    authority = false;
    expect(
      (
        await request(app)
          .get("/api/service-marketplace/vendors/3/capabilities")
          .set("Cookie", vendor)
      ).status,
    ).toBe(403);
    authority = true;
    expect(
      (
        await request(app)
          .get("/api/service-marketplace/vendors/3/capabilities")
          .set("Cookie", buildTestCookie({ userId: 1, role: "admin" }))
      ).status,
    ).toBe(200);
  });
  it("saves capability wording, triggers classification, and scopes edits", async () => {
    const result = await request(app)
      .post("/api/service-marketplace/vendors/3/capabilities")
      .set("Cookie", vendor)
      .send({ name: "Gate crews", capacity: 3 });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      vendorId: 3,
      name: "Gate crews",
      capacity: 3,
    });
    expect(classifications).toBe(1);
    expect(
      (
        await request(app)
          .patch("/api/service-marketplace/vendors/3/capabilities/999")
          .set("Cookie", vendor)
          .send({ active: false })
      ).status,
    ).toBe(404);
  });
  it("rejects injected ownership, mapping, compliance, and unverified coordinates", async () => {
    expect(
      (
        await request(app)
          .post("/api/service-marketplace/vendors/3/capabilities")
          .set("Cookie", vendor)
          .send({
            name: "Gate",
            vendorId: 99,
            canonicalServiceId: 5,
            complianceCurrent: true,
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put("/api/service-marketplace/vendors/3/service-areas")
          .set("Cookie", vendor)
          .send({
            radiusMiles: 500,
            latitude: 35,
            longitude: -97,
            verifiedAt: new Date(),
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put("/api/service-marketplace/vendors/3/service-areas")
          .set("Cookie", vendor)
          .send({ vendorCapabilityId: 999, radiusMiles: 500 })
      ).status,
    ).toBe(404);
    const result = await request(app)
      .put("/api/service-marketplace/vendors/3/service-areas")
      .set("Cookie", vendor)
      .send({ radiusMiles: 500 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      radiusMiles: "500",
      address: "Saved base",
    });
  });
  it("projects approved demand without requiring a relationship or exposing private evidence", async () => {
    const result = await request(app)
      .get("/api/service-marketplace/vendors/3/matching-demand")
      .set("Cookie", vendor);
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({
      partnerId: 9,
      partnerName: "Flywheel",
      name: "Gatekeeping",
      locations: [{ state: "OK", approximateSiteCount: 10 }],
      ownOffer: null,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /secret|competitor|budget|privateNotes|internalEvidence/i,
    );
  });
  it("saves only own partner terms after a current canonical match", async () => {
    const body = {
      vendorCapabilityId: 7,
      workTypeId: 21,
      unitPrice: 75,
      unit: "hour",
      capacity: 2,
    };
    const result = await request(app)
      .put("/api/service-marketplace/vendors/3/partner-rates")
      .set("Cookie", vendor)
      .send(body);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      partnerId: 9,
      unitPrice: "75",
      vendorCapabilityId: 7,
    });
    expect(
      (
        await request(app)
          .put("/api/service-marketplace/vendors/3/partner-rates")
          .set("Cookie", vendor)
          .send({ ...body, workTypeId: 999 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .put("/api/service-marketplace/vendors/3/partner-rates")
          .set("Cookie", vendor)
          .send({ ...body, partnerId: 99 })
      ).status,
    ).toBe(400);
  });
  it("keeps generated capability contracts strict about required wording", () => {
    expect(
      CreateVendorMarketplaceCapabilityBody.safeParse({ capacity: 2 }).success,
    ).toBe(false);
    const { name: _name, ...incomplete } = capability;
    expect(
      ListVendorMarketplaceCapabilitiesResponse.safeParse({
        items: [incomplete],
      }).success,
    ).toBe(false);
  });
  it("does not erase saved wording, rates, or capacity on a partial edit", async () => {
    const result = await request(app)
      .patch("/api/service-marketplace/vendors/3/capabilities/7")
      .set("Cookie", vendor)
      .send({ active: false });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      name: "Gate Services",
      description: "Visitor logs",
      defaultUnit: "hour",
      capacity: 2,
      active: false,
    });
    expect(classifications).toBe(0);
  });
  it("rejects fractional cents instead of silently rounding commercial terms", async () => {
    const result = await request(app)
      .put("/api/service-marketplace/vendors/3/partner-rates")
      .set("Cookie", vendor)
      .send({
        vendorCapabilityId: 7,
        workTypeId: 21,
        unitPrice: 75.001,
        unit: "hour",
      });
    expect(result.status).toBe(400);
  });
});
