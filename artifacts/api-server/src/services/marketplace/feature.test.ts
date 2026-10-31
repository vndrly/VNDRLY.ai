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
      return {
        rows: state.rows
          .filter(
            (row) => row.site_id === null || row.site_id === parameters[3],
          )
          .sort(
            (a, b) => Number(b.site_id !== null) - Number(a.site_id !== null),
          )
          .slice(0, 1),
      };
    },
  },
}));
import { isSemanticMarketplaceEnabled } from "./feature";
import { createServiceMarketplaceRouter } from "../../routes/serviceMarketplace";
import type { JobOfferService } from "./job-offers";

const draft = {
  partnerId: 9,
  vendorId: 3,
  workTypeId: 21,
  vendorCapabilityId: 7,
  vendorPartnerServiceOfferId: 12,
  siteLocationId: 8,
  scope: "Synthetic controlled entry",
  afeCode: "SYNTHETIC-PARTNER-AFE",
  requestedStartAt: "2026-11-01T10:00:00Z",
  requestedEndAt: "2026-11-01T12:00:00Z",
  crewCount: 1,
  attachmentUrls: [],
  expiresAt: "2026-10-31T10:00:00Z",
};

beforeEach(() => {
  state.rows = [];
  state.parameters = [];
});

describe("job offer flag scope boundaries", () => {
  const saved = {
    ...draft,
    id: 10,
    commercialSnapshot: { unitPrice: "75.00" },
    idempotencyKey: "private",
  };
  const jobOffers = {
    listJobOffers: async () => [saved],
    getJobOffer: async () => saved,
    createJobOffer: async () => saved,
  } as unknown as JobOfferService;
  const app = () =>
    express()
      .use(cookieParser())
      .use(express.json())
      .use("/api", createServiceMarketplaceRouter({ jobOffers }));
  const cookie = (side: "partner" | "vendor", admin = false) =>
    buildTestCookie({
      role: admin ? "admin" : side,
      userId: 7,
      partnerId: side === "partner" && !admin ? 9 : null,
      vendorId: side === "vendor" && !admin ? 3 : null,
      activeMembershipId: 4,
      membershipRole: "admin",
    });
  for (const side of ["partner", "vendor"] as const) {
    it(`keeps ${side} list organization-scoped when a forged site is disabled`, async () => {
      state.rows = [
        { enabled: true, site_id: null },
        { enabled: false, site_id: 8 },
      ];
      const orgId = side === "partner" ? 9 : 3;
      const response = await request(app())
        .get(`/api/service-marketplace/${side}s/${orgId}/job-offers`)
        .set("Cookie", cookie(side))
        .query({ siteId: 8, siteLocationId: 8 })
        .send({ siteLocationId: 8 });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ items: [{ id: 10 }] });
      expect(state.parameters).toEqual([
        side,
        orgId,
        "semantic_service_marketplace",
        null,
      ]);
    });
    for (const admin of [false, true]) {
      for (const organizationRow of ["missing", "disabled"] as const) {
        it.each(["body", "query", "both"])(
          `keeps ${side} list denied for ${admin ? "support admin" : "owner"} with ${organizationRow} org flag and forged %s site`,
          async (source) => {
            state.rows = [
              ...(organizationRow === "disabled"
                ? [{ enabled: false, site_id: null }]
                : []),
              { enabled: true, site_id: 8 },
            ];
            const orgId = side === "partner" ? 9 : 3;
            const call = request(app())
              .get(`/api/service-marketplace/${side}s/${orgId}/job-offers`)
              .set("Cookie", cookie(side, admin));
            if (source !== "body") call.query({ siteId: 8, siteLocationId: 8 });
            if (source !== "query") call.send({ siteId: 8, siteLocationId: 8 });
            const response = await call;
            expect(response.status).toBe(403);
            expect(response.body).toMatchObject({
              code: "marketplace.disabled",
            });
            expect(state.parameters).toEqual([
              side,
              orgId,
              "semantic_service_marketplace",
              null,
            ]);
          },
        );
      }
    }
  }
  it("allows a validated create at an enabled site while its organization is disabled", async () => {
    state.rows = [
      { enabled: false, site_id: null },
      { enabled: true, site_id: 8 },
    ];
    const response = await request(app())
      .post("/api/service-marketplace/job-offers")
      .set("Cookie", cookie("partner"))
      .set("Idempotency-Key", "site-create")
      .send(draft);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 10,
      partnerId: 9,
      siteLocationId: 8,
    });
    expect(state.parameters).toEqual([
      "partner",
      9,
      "semantic_service_marketplace",
      8,
    ]);
  });
  it.each(["partner", "vendor"] as const)(
    "keeps %s detail at the authorized saved offer site despite forged body and query",
    async (side) => {
      state.rows = [
        { enabled: false, site_id: null },
        { enabled: true, site_id: 8 },
      ];
      const response = await request(app())
        .get("/api/service-marketplace/job-offers/10")
        .set("Cookie", cookie(side))
        .query({ siteId: 999, siteLocationId: 999 })
        .send({ siteLocationId: 999 });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: 10, siteLocationId: 8 });
      expect(state.parameters).toEqual([
        side,
        side === "partner" ? 9 : 3,
        "semantic_service_marketplace",
        8,
      ]);
    },
  );
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
          method === "get"
            ? undefined
            : path === "/job-offers"
              ? draft
              : { partnerId: 9, siteLocationId: 8 },
        );
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("marketplace.disabled");
    },
  );
});
