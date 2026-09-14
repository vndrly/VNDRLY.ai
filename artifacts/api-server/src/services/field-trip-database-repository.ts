import { and, desc, eq, isNull } from "drizzle-orm";
import { db, fieldTripLocationPointsTable, fieldTripsTable, siteLocationsTable } from "@workspace/db";
import type { FieldTripRecord, FieldTripRepository, TripPoint } from "./field-trips";

function pointFrom(row: typeof fieldTripsTable.$inferSelect): TripPoint | null {
  if (row.lastLatitude == null || row.lastLongitude == null || row.lastAccuracyMeters == null || !row.lastRecordedAt) return null;
  return { latitude: row.lastLatitude, longitude: row.lastLongitude, accuracyMeters: row.lastAccuracyMeters, speedMps: row.lastSpeedMps, recordedAt: row.lastRecordedAt };
}

function mapTrip(row: typeof fieldTripsTable.$inferSelect): FieldTripRecord {
  return {
    id: row.id,
    operationId: row.operationId,
    owner: { type: row.ownerOrgType as "vendor" | "partner", id: row.ownerOrgId },
    driverUserId: row.driverUserId,
    vehicleAssetId: row.vehicleAssetId,
    assignmentId: row.assignmentId,
    siteLocationId: row.siteLocationId,
    destinationSource: row.destinationSource as FieldTripRecord["destinationSource"],
    activeShiftId: row.activeShiftId,
    trackingState: row.trackingState as FieldTripRecord["trackingState"],
    presenceState: row.presenceState as FieldTripRecord["presenceState"],
    lastReliablePoint: pointFrom(row),
    finalVisitId: row.finalVisitId,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    completedAt: row.completedAt,
    version: row.version,
  };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const databaseFieldTripRepository: FieldTripRepository = {
  async create(input) {
    const [created] = await db.insert(fieldTripsTable).values({
      operationId: input.operationId,
      ownerOrgType: input.owner.type,
      ownerOrgId: input.owner.id,
      driverUserId: input.driverUserId,
      vehicleAssetId: input.vehicleAssetId,
      assignmentId: input.assignmentId,
      siteLocationId: input.siteLocationId,
      destinationSource: input.destinationSource,
      activeShiftId: input.activeShiftId,
    }).onConflictDoNothing({ target: fieldTripsTable.operationId }).returning();
    if (created) return mapTrip(created);
    const [replay] = await db.select().from(fieldTripsTable).where(eq(fieldTripsTable.operationId, input.operationId)).limit(1);
    if (!replay) throw new Error("trip.create_failed");
    return mapTrip(replay);
  },
  async findByOperation(operationId) {
    const [row] = await db.select().from(fieldTripsTable).where(eq(fieldTripsTable.operationId, operationId)).limit(1);
    return row ? mapTrip(row) : null;
  },
  async get(id) {
    const [row] = await db.select().from(fieldTripsTable).where(eq(fieldTripsTable.id, id)).limit(1);
    return row ? mapTrip(row) : null;
  },
  async save(trip, expectedVersion) {
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(fieldTripsTable).set({
        trackingState: trip.trackingState,
        presenceState: trip.presenceState,
        lastLatitude: trip.lastReliablePoint?.latitude ?? null,
        lastLongitude: trip.lastReliablePoint?.longitude ?? null,
        lastAccuracyMeters: trip.lastReliablePoint?.accuracyMeters ?? null,
        lastSpeedMps: trip.lastReliablePoint?.speedMps ?? null,
        lastRecordedAt: trip.lastReliablePoint?.recordedAt ?? null,
        lastPointReliable: Boolean(trip.lastReliablePoint),
        finalVisitId: trip.finalVisitId,
        pausedAt: trip.pausedAt,
        completedAt: trip.completedAt,
        version: expectedVersion + 1,
        updatedAt: new Date(),
      }).where(and(eq(fieldTripsTable.id, trip.id), eq(fieldTripsTable.version, expectedVersion))).returning();
      if (!updated) return null;
      if (trip.lastReliablePoint) {
        const [latest] = await tx.select({ recordedAt: fieldTripLocationPointsTable.recordedAt })
          .from(fieldTripLocationPointsTable)
          .where(eq(fieldTripLocationPointsTable.tripId, trip.id))
          .orderBy(desc(fieldTripLocationPointsTable.recordedAt))
          .limit(1);
        if (!latest || latest.recordedAt.getTime() !== trip.lastReliablePoint.recordedAt.getTime()) {
          const [site] = await tx.select({ latitude: siteLocationsTable.latitude, longitude: siteLocationsTable.longitude })
            .from(siteLocationsTable).where(eq(siteLocationsTable.id, trip.siteLocationId)).limit(1);
          await tx.insert(fieldTripLocationPointsTable).values({
            tripId: trip.id,
            ...trip.lastReliablePoint,
            distanceToSiteMeters: site ? distanceMeters(trip.lastReliablePoint.latitude, trip.lastReliablePoint.longitude, site.latitude, site.longitude) : null,
            reliable: trip.lastReliablePoint.accuracyMeters <= 100,
          });
        }
      }
      return mapTrip(updated);
    });
  },
};

export async function findActiveTripForDriver(driverUserId: number): Promise<FieldTripRecord | null> {
  const [row] = await db.select().from(fieldTripsTable).where(and(eq(fieldTripsTable.driverUserId, driverUserId), eq(fieldTripsTable.trackingState, "active"), isNull(fieldTripsTable.completedAt))).orderBy(desc(fieldTripsTable.startedAt)).limit(1);
  return row ? mapTrip(row) : null;
}
