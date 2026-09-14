import { randomUUID } from "node:crypto";
import { estimateMapboxDrivingRoute, type RouteEstimateResult } from "../lib/mapbox-routing";

export type TripOwner = { type: "vendor" | "partner"; id: number };
export type TripPoint = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMps: number | null;
  recordedAt: Date;
};
export type FieldTripRecord = {
  id: string;
  operationId: string;
  owner: TripOwner;
  driverUserId: number;
  vehicleAssetId: string | null;
  assignmentId: string | null;
  siteLocationId: number;
  destinationSource: "assignment" | "inferred" | "confirmed";
  activeShiftId: string | null;
  trackingState: "active" | "paused" | "completed";
  presenceState: "en_route" | "on_site" | "off_site";
  lastReliablePoint: TripPoint | null;
  finalVisitId: number | null;
  startedAt: Date;
  pausedAt: Date | null;
  completedAt: Date | null;
  version: number;
};

export class FieldTripError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export interface FieldTripRepository {
  create(input: Omit<FieldTripRecord, "id" | "version" | "startedAt" | "pausedAt" | "completedAt" | "lastReliablePoint" | "trackingState" | "presenceState" | "finalVisitId">): Promise<FieldTripRecord>;
  findByOperation(operationId: string): Promise<FieldTripRecord | null>;
  get(id: string): Promise<FieldTripRecord | null>;
  save(trip: FieldTripRecord, expectedVersion: number): Promise<FieldTripRecord | null>;
}

export function createMemoryFieldTripRepository(): FieldTripRepository {
  const trips = new Map<string, FieldTripRecord>();
  return {
    async create(input) {
      const row: FieldTripRecord = { ...input, id: randomUUID(), version: 1, startedAt: new Date(), pausedAt: null, completedAt: null, lastReliablePoint: null, trackingState: "active", presenceState: "en_route", finalVisitId: null };
      trips.set(row.id, row);
      return structuredClone(row);
    },
    async findByOperation(operationId) { const row = [...trips.values()].find((trip) => trip.operationId === operationId); return row ? structuredClone(row) : null; },
    async get(id) { const row = trips.get(id); return row ? structuredClone(row) : null; },
    async save(trip, expectedVersion) {
      const current = trips.get(trip.id);
      if (!current || current.version !== expectedVersion) return null;
      const saved = structuredClone({ ...trip, version: expectedVersion + 1 });
      trips.set(saved.id, saved);
      return structuredClone(saved);
    },
  };
}

type RouteEstimator = typeof estimateMapboxDrivingRoute;

export function createFieldTripService(repository: FieldTripRepository, routeEstimator: RouteEstimator = estimateMapboxDrivingRoute) {
  async function current(id: string) {
    const trip = await repository.get(id);
    if (!trip) throw new FieldTripError("trip.not_found", 404);
    return trip;
  }
  return {
    async startTrip(input: Omit<FieldTripRecord, "id" | "version" | "startedAt" | "pausedAt" | "completedAt" | "lastReliablePoint" | "trackingState" | "presenceState" | "finalVisitId">) {
      const replay = await repository.findByOperation(input.operationId);
      return replay ?? repository.create(input);
    },
    async updateTripLocation(input: { tripId: string; expectedVersion: number; latitude: number; longitude: number; accuracyMeters: number; speedMps: number | null; recordedAt: Date }) {
      const trip = await current(input.tripId);
      if (trip.trackingState !== "active") throw new FieldTripError("trip.tracking_not_active");
      if (trip.version !== input.expectedVersion) throw new FieldTripError("trip.version_conflict");
      if (![input.latitude, input.longitude, input.accuracyMeters].every(Number.isFinite) || input.accuracyMeters < 0) throw new FieldTripError("trip.invalid_location", 400);
      if (input.accuracyMeters <= 100) trip.lastReliablePoint = { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters, speedMps: input.speedMps, recordedAt: input.recordedAt };
      const saved = await repository.save(trip, input.expectedVersion);
      if (!saved) throw new FieldTripError("trip.version_conflict");
      return saved;
    },
    async estimateTripEta(tripId: string, destination: { latitude: number; longitude: number }, now = new Date()) {
      const trip = await current(tripId);
      if (!trip.lastReliablePoint) return { ok: false as const, code: "trip.location_unavailable" };
      const estimate: RouteEstimateResult = await routeEstimator({ origin: trip.lastReliablePoint, destination });
      if (!estimate.ok) return { ...estimate, sourceRecordedAt: trip.lastReliablePoint.recordedAt, sourceAgeSeconds: Math.max(0, Math.round((now.getTime() - trip.lastReliablePoint.recordedAt.getTime()) / 1_000)) };
      return { ...estimate, estimatedAt: now, sourceRecordedAt: trip.lastReliablePoint.recordedAt, sourceAgeSeconds: Math.max(0, Math.round((now.getTime() - trip.lastReliablePoint.recordedAt.getTime()) / 1_000)) };
    },
    async finalizeAutomaticPresence(input: { tripId: string; expectedVersion: number; direction: "entry" | "exit"; visitId: number; crossedAt: Date }) {
      const trip = await current(input.tripId);
      if (trip.version !== input.expectedVersion) throw new FieldTripError("trip.version_conflict");
      trip.presenceState = input.direction === "entry" ? "on_site" : "off_site";
      trip.finalVisitId = input.visitId;
      if (input.direction === "exit") { trip.trackingState = "completed"; trip.completedAt = input.crossedAt; }
      const saved = await repository.save(trip, input.expectedVersion);
      if (!saved) throw new FieldTripError("trip.version_conflict");
      return saved;
    },
    async pauseWorkTracking(input: { tripId: string; expectedVersion: number; actorUserId: number }) {
      const trip = await current(input.tripId);
      if (trip.driverUserId !== input.actorUserId) throw new FieldTripError("trip.driver_required", 403);
      if (trip.version !== input.expectedVersion) throw new FieldTripError("trip.version_conflict");
      trip.trackingState = "paused";
      trip.pausedAt = new Date();
      const saved = await repository.save(trip, input.expectedVersion);
      if (!saved) throw new FieldTripError("trip.version_conflict");
      return saved;
    },
  };
}
