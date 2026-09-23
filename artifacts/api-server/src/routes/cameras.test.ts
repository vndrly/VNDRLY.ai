import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createCamerasRouter, type CameraRouteDependencies } from "./cameras";

function setup(overrides: Partial<CameraRouteDependencies> = {}) {
  const dependencies: CameraRouteDependencies = {
    getSite: vi.fn(async (siteId) => ({ id: siteId, partnerId: 22 })),
    getGatewaySite: vi.fn(async () => ({ id: 11, partnerId: 22 })),
    listSiteCameras: vi.fn(async () => ({ gateways: [] })),
    createGateway: vi.fn(async (input) => ({
      gateway: {
        id: "f097a8d4-6f04-4dd8-88f7-abd815a1b680",
        siteLocationId: input.siteLocationId,
        name: input.name,
        status: "pending",
      },
      enrollmentToken: "one-time-enrollment-token",
    })),
    addCredentialReference: vi.fn(async (input) => ({
      id: "c0450cd7-1e4f-4c25-b4db-4b7dc77563ad",
      gatewayId: input.gatewayId,
      externalRef: input.externalRef,
      label: input.label,
      scope: input.scope,
    })),
    authenticateGateway: vi.fn(async () => true),
    heartbeatGateway: vi.fn(async () => undefined),
    reconcileInventory: vi.fn(async () => ({ devices: [] })),
    getChannelSite: vi.fn(async () => ({ id: 11, partnerId: 22 })),
    createPlaybackDescriptor: vi.fn(async () => ({
      protocol: "webrtc" as const,
      url: "wss://gateway.example.test/session/one",
      expiresAt: "2026-09-23T02:01:00.000Z",
    })),
    ...overrides,
  };
  const app = express()
    .use(express.json())
    .use(cookieParser())
    .use(createCamerasRouter(dependencies));
  return { app, dependencies };
}

const partnerAdmin = buildTestCookie({
  userId: 7,
  role: "partner",
  partnerId: 22,
  membershipRole: "admin",
});

describe("camera routes", () => {
  it("requires authentication before listing a site's camera metadata", async () => {
    const { app } = setup();
    const response = await request(app).get("/sites/11/cameras");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("auth.not_authenticated");
  });

  it("denies a partner access to another partner's camera registry", async () => {
    const { app, dependencies } = setup({
      getSite: vi.fn(async () => ({ id: 11, partnerId: 99 })),
    });
    const response = await request(app)
      .get("/sites/11/cameras")
      .set("Cookie", partnerAdmin);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("auth.forbidden");
    expect(dependencies.listSiteCameras).not.toHaveBeenCalled();
  });

  it("returns a gateway enrollment token once without storing or echoing credentials", async () => {
    const { app, dependencies } = setup();
    const response = await request(app)
      .post("/sites/11/camera-gateways")
      .set("Cookie", partnerAdmin)
      .send({ name: "Gate office gateway" });
    expect(response.status).toBe(201);
    expect(response.body.enrollmentToken).toBe("one-time-enrollment-token");
    expect(dependencies.createGateway).toHaveBeenCalledWith(
      expect.objectContaining({ siteLocationId: 11, createdByUserId: 7 }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/password|rtsp:\/\//i);
  });

  it("accepts opaque reusable credential references but rejects secret material", async () => {
    const { app } = setup();
    const accepted = await request(app)
      .post("/camera-gateways/f097a8d4-6f04-4dd8-88f7-abd815a1b680/credential-references")
      .set("Cookie", partnerAdmin)
      .send({
        externalRef: "site-main-readonly",
        label: "All four site recorders",
        scope: { permissions: ["view"] },
      });
    expect(accepted.status).toBe(201);
    expect(JSON.stringify(accepted.body)).not.toMatch(/password|secret/i);

    const rejected = await request(app)
      .post("/camera-gateways/f097a8d4-6f04-4dd8-88f7-abd815a1b680/credential-references")
      .set("Cookie", partnerAdmin)
      .send({
        externalRef: "site-main-readonly",
        label: "Unsafe",
        scope: { permissions: ["view"] },
        password: "do-not-store-this",
      });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).not.toContain("do-not-store-this");
  });

  it("requires a gateway bearer token for heartbeat and inventory", async () => {
    const { app, dependencies } = setup();
    const denied = await request(app).post(
      "/camera-gateways/f097a8d4-6f04-4dd8-88f7-abd815a1b680/heartbeat",
    );
    expect(denied.status).toBe(401);

    const accepted = await request(app)
      .post("/camera-gateways/f097a8d4-6f04-4dd8-88f7-abd815a1b680/heartbeat")
      .set("Authorization", "Bearer gateway-token")
      .send({ softwareVersion: "1.0.0", playbackBaseUrl: "https://gateway.example.test" });
    expect(accepted.status).toBe(204);
    expect(dependencies.heartbeatGateway).toHaveBeenCalled();
  });
});
