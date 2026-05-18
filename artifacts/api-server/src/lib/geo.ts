// Geo helpers shared across routes. Kept tiny so it can be exercised by unit
// tests without pulling in the whole tickets router.

// Demo geofence bypass — set 24h forward from the moment of edit so the demo
// can drive every lifecycle step (en-route → check-in → check-out → submit)
// from anywhere in the dev workflow, then naturally revert to real geofence
// enforcement when the constant expires. No env var, no DB row, no cleanup
// required: editing this constant is the single place to extend or end the
// bypass window.
//
// IMPORTANT: gated on NODE_ENV === "development" so the bypass can never
// reach production (where NODE_ENV is "production") and so the e2e geofence
// tests (which run with NODE_ENV unset / "test") still see real enforcement.
export const GEOFENCE_BYPASS_UNTIL_MS: number = Date.UTC(2026, 3, 30, 23, 0, 0);

export function isGeofenceBypassActive(now: number = Date.now()): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return now < GEOFENCE_BYPASS_UNTIL_MS;
}

export function radiusMilesBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles.
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
