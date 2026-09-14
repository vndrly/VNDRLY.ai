import { describe, expect, it, vi } from "vitest";
import {
  createFieldTripService,
  createMemoryFieldTripRepository,
} from "./field-trips";

describe("field trips", () => {
  it("starts one idempotent trip and pauses tracking without losing the last point", async () => {
    const service = createFieldTripService(createMemoryFieldTripRepository());
    const trip = await service.startTrip({ operationId: "00000000-0000-4000-8000-000000000001", owner: { type: "vendor", id: 1 }, driverUserId: 9, vehicleAssetId: null, assignmentId: "assignment-1", siteLocationId: 44, destinationSource: "assignment", activeShiftId: null });
    const replay = await service.startTrip({ operationId: "00000000-0000-4000-8000-000000000001", owner: { type: "vendor", id: 1 }, driverUserId: 9, vehicleAssetId: null, assignmentId: "assignment-1", siteLocationId: 44, destinationSource: "assignment", activeShiftId: null });
    expect(replay.id).toBe(trip.id);
    const updated = await service.updateTripLocation({ tripId: trip.id, expectedVersion: trip.version, latitude: 31, longitude: -102, accuracyMeters: 8, speedMps: 20, recordedAt: new Date() });
    const paused = await service.pauseWorkTracking({ tripId: trip.id, expectedVersion: updated.version, actorUserId: 9 });
    expect(paused.trackingState).toBe("paused");
    expect(paused.lastReliablePoint).toMatchObject({ latitude: 31, longitude: -102 });
  });

  it("returns an ETA with estimate time and source freshness", async () => {
    const route = vi.fn().mockResolvedValue({ ok: true, provider: "mapbox", trafficAware: true, distanceMiles: 12, durationMinutes: 14, routeConfidence: "high" });
    const service = createFieldTripService(createMemoryFieldTripRepository(), route);
    const trip = await service.startTrip({ operationId: "00000000-0000-4000-8000-000000000002", owner: { type: "vendor", id: 1 }, driverUserId: 9, vehicleAssetId: null, assignmentId: null, siteLocationId: 44, destinationSource: "confirmed", activeShiftId: null });
    const recordedAt = new Date("2026-09-13T12:00:00.000Z");
    await service.updateTripLocation({ tripId: trip.id, expectedVersion: trip.version, latitude: 31, longitude: -102, accuracyMeters: 8, speedMps: 20, recordedAt });
    const eta = await service.estimateTripEta(trip.id, { latitude: 31.2, longitude: -101.8 }, new Date("2026-09-13T12:01:00.000Z"));
    expect(eta).toMatchObject({ ok: true, durationMinutes: 14, sourceRecordedAt: recordedAt, sourceAgeSeconds: 60 });
  });
});
