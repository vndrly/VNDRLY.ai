import { gateRadiusFor } from "./gate-test-allowance";
type Point = { latitude?: unknown; longitude?: unknown };
export type GateGpsTarget = { id: string; name: string; siteId?: number; latitude: number | null; longitude: number | null; geofenceRadiusM: number };
/** GPS is observational evidence, never permission to record a gate visit. */
export function gateVisitGpsEvidence(point: Point, gate: GateGpsTarget | null, userId?: number | null) {
  const valid = typeof point.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && typeof point.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
  // A testing allowance widens the boundary for its one user; the record names it so the match is not mistaken for the gate's own radius.
  const boundary = gate ? gateRadiusFor(userId, gate.siteId, gate.geofenceRadiusM) : null;
  const base = { gateStationId: gate?.id ?? null, gateName: gate?.name ?? null, gateLatitude: gate?.latitude ?? null, gateLongitude: gate?.longitude ?? null, radiusMeters: boundary?.radiusMeters ?? null, ...(boundary?.allowance ? { allowance: "testing" } : {}), recordedAt: new Date().toISOString(), latitude: valid ? point.latitude as number : null, longitude: valid ? point.longitude as number : null };
  if (!valid) return { ...base, status: "unavailable", distanceMeters: null };
  if (!gate || !boundary || gate.latitude == null || gate.longitude == null) return { ...base, status: "gate_unconfigured", distanceMeters: null };
  const rad = (v: number) => v * Math.PI / 180;
  const a = Math.sin(rad((point.latitude as number) - gate.latitude) / 2) ** 2 + Math.cos(rad(gate.latitude)) * Math.cos(rad(point.latitude as number)) * Math.sin(rad((point.longitude as number) - gate.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return { ...base, status: distance <= boundary.radiusMeters ? "verified" : "mismatch", distanceMeters: Math.round(distance) };
}
