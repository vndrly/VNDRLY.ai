import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createWorkHubGovernanceRouter } from "./workHubGovernance";

const id = "11111111-1111-4111-8111-111111111111";
const cookie = buildTestCookie({
  userId: 22,
  role: "vendor",
  vendorId: 41,
  membershipRole: "admin",
  displayName: "Casey",
});
function harness() {
  const service = {
    currentPolicy: vi.fn(async () => null),
    policyHistory: vi.fn(async () => []),
    createPolicy: vi.fn(async () => ({ replayed: false })),
    minimumHistory: vi.fn(async () => []),
    createMinimum: vi.fn(async () => ({ replayed: false })),
    listHolds: vi.fn(async () => []),
    createHold: vi.fn(async () => ({ replayed: false })),
    releaseHold: vi.fn(async () => ({ replayed: false })),
    createPlan: vi.fn(async () => ({ replayed: false, resource: { id } })),
    readPlan: vi.fn(async () => ({ id })),
    readMetrics: vi.fn(async () => ({ from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z", buckets: [] })),
    readPlatformMetrics: vi.fn(async () => ({ from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z", buckets: [] })),
  } as any;
  return {
    service,
    app: express()
      .use(express.json())
      .use(cookieParser())
      .use(createWorkHubGovernanceRouter({ service })),
  };
}

describe("Work Hub governance HTTP boundary", () => {
  it("requires authentication", async () => {
    expect(
      (
        await request(harness().app).get(
          "/work-hub/governance/retention/policies?ownerType=vendor&ownerId=41",
        )
      ).status,
    ).toBe(401);
  });

  it("parses the exact owner and trusted client source for policy creation", async () => {
    const h = harness();
    const response = await request(h.app)
      .post("/work-hub/governance/retention/policies")
      .set("Cookie", cookie)
      .set("x-vndrly-client", "ios")
      .send({
        operationId: id,
        owner: { type: "vendor", id: 41 },
        rules: { messages: 30 },
      });
    expect(response.status).toBe(201);
    expect(h.service.createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 22, source: "ios" } }),
    );
  });

  it("rejects an invalid query owner before repository access", async () => {
    const h = harness();
    expect(
      (
        await request(h.app)
          .get(
            "/work-hub/governance/legal-holds?ownerType=vendor&ownerId=other",
          )
          .set("Cookie", cookie)
      ).status,
    ).toBe(400);
    expect(h.service.listHolds).not.toHaveBeenCalled();
  });

  it("rejects an owner id above the database range before service or database access", async () => {
    const h = harness();
    const response = await request(h.app)
      .get(
        "/work-hub/governance/legal-holds?ownerType=vendor&ownerId=2147483648",
      )
      .set("Cookie", cookie);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation.invalid_request");
    expect(h.service.listHolds).not.toHaveBeenCalled();
  });

  it("returns controlled 400 for malformed hold ids before service or database access", async () => {
    const h = harness();
    const response = await request(h.app)
      .post("/work-hub/governance/legal-holds")
      .set("Cookie", cookie)
      .send({
        operationId: id,
        owner: { type: "vendor", id: 41 },
        subject: { type: "meeting_occurrence", id: "not-a-uuid" },
        reason: "preserve",
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("validation.invalid_request");
    expect(h.service.createHold).not.toHaveBeenCalled();
  });

  it("routes release with owner scope and rejects a replacement reason", async () => {
    const h = harness();
    const rejected = await request(h.app)
      .post(
        `/work-hub/governance/legal-holds/${id}/release?ownerType=vendor&ownerId=41`,
      )
      .set("Cookie", cookie)
      .send({ operationId: id, reason: "replace history" });
    expect(rejected.status).toBe(400);
    const response = await request(h.app)
      .post(
        `/work-hub/governance/legal-holds/${id}/release?ownerType=vendor&ownerId=41`,
      )
      .set("Cookie", cookie)
      .send({ operationId: id });
    expect(response.status).toBe(200);
    expect(h.service.releaseHold).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: "vendor", id: 41 },
        body: { operationId: id, holdId: id },
      }),
    );
  });

  it("creates and reads only owner-scoped retention dry-run plans", async () => {
    const h = harness();
    const created = await request(h.app)
      .post("/work-hub/governance/retention/plans")
      .set("Cookie", cookie)
      .set("x-vndrly-client", "ios")
      .send({ operationId: id, owner: { type: "vendor", id: 41 } });
    expect(created.status).toBe(202);
    expect(h.service.createPlan).toHaveBeenCalledWith({ actor: { userId: 22, source: "ios" }, body: { operationId: id, owner: { type: "vendor", id: 41 } } });
    const read = await request(h.app)
      .get(`/work-hub/governance/retention/plans/${id}?ownerType=vendor&ownerId=41`)
      .set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(h.service.readPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: id, owner: { type: "vendor", id: 41 } }));
  });

  it("rejects a malformed plan id before service or database access", async () => {
    const h = harness();
    const response = await request(h.app)
      .get("/work-hub/governance/retention/plans/not-a-uuid?ownerType=vendor&ownerId=41")
      .set("Cookie", cookie);
    expect(response.status).toBe(400);
    expect(h.service.readPlan).not.toHaveBeenCalled();
  });

  it("routes bounded owner and platform metric readouts without accepting identifiers", async () => {
    const h = harness();
    const query = "from=2026-09-10T20%3A00%3A00.000Z&to=2026-09-10T21%3A00%3A00.000Z";
    const ownerResponse = await request(h.app).get(`/work-hub/governance/metrics?ownerType=vendor&ownerId=41&${query}`).set("Cookie", cookie);
    expect(ownerResponse.status).toBe(200);
    expect(h.service.readMetrics).toHaveBeenCalledWith({ actor: { userId: 22, source: "web" }, owner: { type: "vendor", id: 41 }, query: { from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z" } });
    const platformResponse = await request(h.app).get(`/work-hub/governance/metrics/platform?${query}`).set("Cookie", cookie);
    expect(platformResponse.status).toBe(200);
    expect(h.service.readPlatformMetrics).toHaveBeenCalledWith({ actor: { userId: 22, source: "web" }, query: { from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z" } });
    const rejected = await request(h.app).get(`/work-hub/governance/metrics?ownerType=vendor&ownerId=41&${query}&userId=22`).set("Cookie", cookie);
    expect(rejected.status).toBe(400);
  });
});
