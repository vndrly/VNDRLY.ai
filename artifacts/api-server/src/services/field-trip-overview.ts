import { and, eq, inArray, type SQL } from "drizzle-orm";
import { fieldTripsTable, siteLocationsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { FieldTripError } from "./field-trips";

export function fieldTripOverviewScope(session: SessionPayload): SQL | undefined {
  if (!session.userId) throw new FieldTripError("trip.unauthenticated", 401);
  if (session.role === "admin") return undefined;
  if (session.role === "partner" && session.partnerId) return eq(siteLocationsTable.partnerId, session.partnerId);
  if (session.role === "vendor" && session.vendorId) return and(eq(fieldTripsTable.ownerOrgType, "vendor"), eq(fieldTripsTable.ownerOrgId, session.vendorId));
  if (session.role === "field_employee" && session.vendorId) {
    const company = and(eq(fieldTripsTable.ownerOrgType, "vendor"), eq(fieldTripsTable.ownerOrgId, session.vendorId));
    return ["dispatcher", "foreman", "both", "gate_supervisor", "safety_manager"].includes(session.vendorRole ?? "") ? company : and(company, eq(fieldTripsTable.driverUserId, session.userId));
  }
  throw new FieldTripError("trip.not_found", 404);
}

export const activeFieldTripFilter = () => inArray(fieldTripsTable.trackingState, ["active", "paused"]);

export function fieldTripOverviewPosition(row: { lastLatitude: number | null; lastLongitude: number | null; lastAccuracyMeters: number | null; lastRecordedAt: Date | null; lastPointReliable: boolean; trackingState: string }, now = Date.now()) {
  const recordedAt = row.lastRecordedAt?.getTime();
  const ageSeconds = recordedAt === undefined ? null : Math.max(0, Math.floor((now - recordedAt) / 1000));
  const valid = row.lastPointReliable && recordedAt !== undefined && recordedAt <= now + 60_000 && row.lastLatitude !== null && row.lastLongitude !== null && Number.isFinite(row.lastLatitude) && Number.isFinite(row.lastLongitude) && Math.abs(row.lastLatitude) <= 90 && Math.abs(row.lastLongitude) <= 180;
  return { location: valid ? { latitude: row.lastLatitude, longitude: row.lastLongitude, accuracyMeters: row.lastAccuracyMeters } : null, recordedAt: row.lastRecordedAt?.toISOString() ?? null, ageSeconds, freshness: !valid ? "unavailable" : row.trackingState !== "active" ? "paused" : ageSeconds! > 900 ? "stale" : "recent" };
}
