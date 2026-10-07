import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ sitePartnerId: 8, eta: vi.fn(), pause: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => ({ userId: 12, partnerId: 8, role: "partner", membershipRole: "admin" }) }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ partnerId: state.sitePartnerId, latitude: 31, longitude: -102 }] }) }) }) } };
});
vi.mock("../services/field-trip-database-repository", () => ({
  databaseFieldTripRepository: { get: async () => ({ id: "00000000-0000-4000-8000-000000000009", driverUserId: 9, owner: { type: "vendor", id: 1 }, siteLocationId: 44, trackingState: "active", presenceState: "en_route", version: 2, lastReliablePoint: { latitude: 35, longitude: -97, recordedAt: new Date() } }) },
  findActiveTripForDriver: vi.fn(),
}));
vi.mock("../services/field-trips", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/field-trips")>();
  return { ...original, createFieldTripService: () => ({ estimateTripEta: state.eta, pauseWorkTracking: state.pause }) };
});
import router from "./implementationATrips";
const app = express(); app.use(express.json()); app.use(router);
const path = "/implementation-a/trips/00000000-0000-4000-8000-000000000009";

describe("partner trip read and mutation separation", () => {
  beforeEach(() => { vi.clearAllMocks(); state.sitePartnerId = 8; state.eta.mockResolvedValue({ ok: true, durationMinutes: 14, distanceMiles: 12, sourceAgeSeconds: 60 }); });
  it("reads a vendor trip at its owned site without revealing coordinates even to a partner administrator", async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "00000000-0000-4000-8000-000000000009", driverUserId: 9, siteLocationId: 44, presenceState: "en_route", trackingState: "active", version: 2, lastLocation: null, route: null });
    const eta = await request(app).get(`${path}/eta`);
    expect(eta.status).toBe(200);
    expect(eta.body).toMatchObject({ durationMinutes: 14, sourceAgeSeconds: 60 });
    expect(state.eta).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000009", expect.objectContaining({ latitude: 31, longitude: -102 }));
  });
  it("hides foreign-site detail and ETA before provider execution", async () => {
    state.sitePartnerId = 99;
    for (const suffix of ["", "/eta"]) {
      const response = await request(app).get(`${path}${suffix}`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("trip.not_found");
    }
    expect(state.eta).not.toHaveBeenCalled();
  });
  it("does not turn owned-site read access into vendor-trip pause authority", async () => {
    const response = await request(app).post(`${path}/pause`).send({ expectedVersion: 2 });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("trip.not_found");
    expect(state.pause).not.toHaveBeenCalled();
  });
});

