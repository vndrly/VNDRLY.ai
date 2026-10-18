import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createServiceMarketplaceRouter } from "./serviceMarketplace";
import { buildTestCookie } from "../test-utils/session";
import type { JobOfferService } from "../services/marketplace/job-offers";

const partner = buildTestCookie({
  role: "partner",
  partnerId: 1,
  userId: 10,
  activeMembershipId: 1,
  membershipRole: "admin",
});
const draft = {
  partnerId: 1,
  vendorId: 2,
  workTypeId: 3,
  vendorCapabilityId: 4,
  vendorPartnerServiceOfferId: 5,
  siteLocationId: 6,
  scope: "Pressure test",
  requestedStartAt: "2026-11-01T10:00:00Z",
  requestedEndAt: "2026-11-01T12:00:00Z",
  crewCount: 2,
  attachmentUrls: [],
  expiresAt: "2026-10-31T10:00:00Z",
};
const service = {
  getJobOffer: async () => ({ id: 8, partnerId: 1, vendorId: 2, siteLocationId: 6 }),
  createJobOffer: async (input: unknown) => ({
    ...(input as object),
    id: 8,
    status: "draft",
    version: 1,
    commercialSnapshot: { unitPrice: "125.00", requestFingerprint: "private" },
    idempotencyKey: "private",
  }),
  acceptJobOffer: async (input: { offerId: number }) => ({
    offerId: input.offerId,
    ticketId: 100,
    replayed: false,
  }),
} as unknown as JobOfferService;
const app = express()
  .use(express.json())
  .use(cookieParser())
  .use("/api", createServiceMarketplaceRouter({ jobOffers: service, isEnabled: async () => true }));
describe("job offer HTTP contract", () => {
  it("requires authentication and the idempotency header", async () => {
    expect(
      (
        await request(app)
          .post("/api/service-marketplace/job-offers")
          .send(draft)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/service-marketplace/job-offers")
          .set("Cookie", partner)
          .send(draft)
      ).status,
    ).toBe(400);
  });
  it("rejects caller supplied prices, authorization, eligibility and impossible schedules", async () => {
    for (const fields of [
      { unitPrice: 1 },
      { eligible: true },
      { authorized: true },
      { requestedEndAt: draft.requestedStartAt },
      { crewCount: 0 },
    ]) {
      const result = await request(app)
        .post("/api/service-marketplace/job-offers")
        .set("Cookie", partner)
        .set("Idempotency-Key", "draft-1")
        .send({ ...draft, ...fields });
      expect(result.status).toBe(400);
    }
  });
  it("returns saved terms without internal idempotency facts", async () => {
    const result = await request(app)
      .post("/api/service-marketplace/job-offers")
      .set("Cookie", partner)
      .set("Idempotency-Key", "draft-1")
      .send(draft);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      id: 8,
      commercialSnapshot: { unitPrice: "125.00" },
    });
    expect(JSON.stringify(result.body)).not.toContain("private");
  });
  it("requires offer version on acceptance and returns canonical ticket identity", async () => {
    const path = "/api/service-marketplace/job-offers/8/accept";
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", partner)
          .set("Idempotency-Key", "accept-1")
          .send({})
      ).status,
    ).toBe(400);
    const response = await request(app)
      .post(path)
      .set("Cookie", partner)
      .set("Idempotency-Key", "accept-1")
      .send({ version: 2 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      offerId: 8,
      ticketId: 100,
      replayed: false,
    });
  });
});
