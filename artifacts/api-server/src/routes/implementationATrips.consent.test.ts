import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ consent: true, userId: 9, resume: vi.fn(), location: vi.fn() }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => ({ userId: state.userId, vendorId: 1, role: "field_employee", vendorRole: "driver" }) }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.consent ? [{ id: 1 }] : [] }) }) }) } };
});
vi.mock("../services/field-trip-database-repository", () => ({
  databaseFieldTripRepository: { get: async () => ({ id: "00000000-0000-4000-8000-000000000009", driverUserId: 9, owner: { type: "vendor", id: 1 }, trackingState: "paused", version: 2 }) },
  findActiveTripForDriver: vi.fn(),
}));
vi.mock("../services/field-trips", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/field-trips")>();
  return { ...original, createFieldTripService: () => ({ resumeWorkTracking: state.resume, updateTripLocation: state.location }) };
});
import router from "./implementationATrips";
const app = express(); app.use(express.json()); app.use(router);
const path = "/implementation-a/trips/00000000-0000-4000-8000-000000000009";

describe("trip tracking consent enforcement", () => {
  beforeEach(() => { vi.clearAllMocks(); state.consent = true; state.userId = 9; state.resume.mockResolvedValue({ trackingState: "active", version: 3 }); });
  it("refuses resume and new location ingestion after consent is revoked", async () => {
    state.consent = false;
    for (const suffix of ["resume", "location"]) {
      const response = await request(app).post(`${path}/${suffix}`).send({ expectedVersion: 2 });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("trip.location_consent_required");
    }
    expect(state.resume).not.toHaveBeenCalled(); expect(state.location).not.toHaveBeenCalled();
  });
  it("allows the consenting driver to resume but rejects a different driver", async () => {
    expect((await request(app).post(`${path}/resume`).send({ expectedVersion: 2 })).status).toBe(200);
    expect(state.resume).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 9, expectedVersion: 2 }));
    state.userId = 10; state.resume.mockClear();
    expect((await request(app).post(`${path}/resume`).send({ expectedVersion: 2 })).status).toBe(404);
    expect(state.resume).not.toHaveBeenCalled();
  });
});
