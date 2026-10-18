import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../../test-utils/session";

const state = vi.hoisted(() => ({
  rows: [] as { enabled: boolean; site_id: number | null }[],
  parameters: [] as unknown[],
}));
vi.mock("@workspace/db", () => ({
  pool: {
    query: async (_sql: string, parameters: unknown[]) => {
      state.parameters = parameters;
      return { rows: state.rows };
    },
  },
}));
import { isSemanticMarketplaceEnabled } from "./feature";
import { createServiceMarketplaceRouter } from "../../routes/serviceMarketplace";
import type { JobOfferService } from "./job-offers";

beforeEach(() => {
  state.rows = [];
  state.parameters = [];
});
describe("semantic marketplace rollout", () => {
  it("defaults missing flags to disabled", async () => {
    expect(
      await isSemanticMarketplaceEnabled({
        ownerOrgType: "partner",
        ownerOrgId: 9,
      }),
    ).toBe(false);
  });
  it("honors an explicit disabled row", async () => {
    state.rows = [{ enabled: false, site_id: null }];
    expect(
      await isSemanticMarketplaceEnabled({
        ownerOrgType: "vendor",
        ownerOrgId: 3,
      }),
    ).toBe(false);
  });
  it.each(["partner", "vendor"] as const)(
    "looks up only the selected %s organization",
    async (ownerOrgType) => {
      state.rows = [{ enabled: true, site_id: null }];
      expect(
        await isSemanticMarketplaceEnabled({ ownerOrgType, ownerOrgId: 9 }),
      ).toBe(true);
      expect(state.parameters).toEqual([
        ownerOrgType,
        9,
        "semantic_service_marketplace",
        null,
      ]);
    },
  );
  it("lets a site explicitly override its organization", async () => {
    state.rows = [{ enabled: false, site_id: 8 }];
    expect(
      await isSemanticMarketplaceEnabled({
        ownerOrgType: "partner",
        ownerOrgId: 9,
        siteId: 8,
      }),
    ).toBe(false);
    expect(state.parameters).toEqual([
      "partner",
      9,
      "semantic_service_marketplace",
      8,
    ]);
  });
  it.each([
    null,
    { ownerOrgType: "admin", ownerOrgId: 1 },
    { ownerOrgType: "vendor", ownerOrgId: 0 },
    { ownerOrgType: "partner", ownerOrgId: 9, siteId: -1 },
  ])("fails closed for missing or invalid support scope %j", async (scope) => {
    expect(await isSemanticMarketplaceEnabled(scope as never)).toBe(false);
    expect(state.parameters).toEqual([]);
  });
  it.each(["vendor", "admin"])(
    "denies a disabled marketplace to %s including support administrators",
    async (role) => {
      const app = express()
        .use(cookieParser())
        .use(express.json())
        .use("/api", createServiceMarketplaceRouter());
      const cookie = buildTestCookie({
        role,
        userId: 7,
        vendorId: role === "vendor" ? 3 : null,
        activeMembershipId: 4,
        membershipRole: "admin",
      });
      const response = await request(app)
        .get("/api/service-marketplace/vendors/3/capabilities")
        .set("Cookie", cookie);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("marketplace.disabled");
      expect(state.parameters).toEqual([
        "vendor",
        3,
        "semantic_service_marketplace",
        null,
      ]);
    },
  );
  it.each([
    ["get", "/partners/9/work-types/21/vendors?siteId=8", "partner"],
    ["post", "/vendors/3/capabilities", "vendor"],
    ["post", "/vendors/3/capabilities/preview", "vendor"],
    ["put", "/vendors/3/service-areas", "vendor"],
    ["put", "/vendors/3/partner-rates", "vendor"],
    ["get", "/vendors/3/matching-demand", "vendor"],
    ["post", "/job-offers", "partner"],
    ["post", "/job-offers/10/send", "partner"],
    ["post", "/job-offers/10/accept", "vendor"],
    ["get", "/vendors/3/job-offers", "admin"],
  ])(
    "blocks disabled %s %s before the domain operation",
    async (method, path, role) => {
      const jobOffers = {
        getJobOffer: async () => ({
          partnerId: 9,
          vendorId: 3,
          siteLocationId: 8,
        }),
      } as unknown as JobOfferService;
      const app = express()
        .use(cookieParser())
        .use(express.json())
        .use("/api", createServiceMarketplaceRouter({ jobOffers }));
      const cookie = buildTestCookie({
        role,
        userId: 7,
        partnerId: role === "partner" ? 9 : null,
        vendorId: role === "vendor" ? 3 : null,
        activeMembershipId: 4,
        membershipRole: "admin",
      });
      const response = await request(app)
        [method as "get"](`/api/service-marketplace${path}`)
        .set("Cookie", cookie)
        .send(
          method === "get" ? undefined : { partnerId: 9, siteLocationId: 8 },
        );
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("marketplace.disabled");
    },
  );
});
