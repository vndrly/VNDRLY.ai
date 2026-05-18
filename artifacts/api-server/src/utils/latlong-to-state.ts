interface StateBounds {
  code: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

const STATE_BOUNDS: StateBounds[] = [
  { code: "AL", latMin: 30.22, latMax: 35.01, lonMin: -88.47, lonMax: -84.89 },
  { code: "AK", latMin: 51.21, latMax: 71.39, lonMin: -179.15, lonMax: -129.98 },
  { code: "AZ", latMin: 31.33, latMax: 37.00, lonMin: -114.81, lonMax: -109.04 },
  { code: "AR", latMin: 33.00, latMax: 36.50, lonMin: -94.62, lonMax: -89.64 },
  { code: "CA", latMin: 32.53, latMax: 42.01, lonMin: -124.41, lonMax: -114.13 },
  { code: "CO", latMin: 36.99, latMax: 41.00, lonMin: -109.06, lonMax: -102.04 },
  { code: "CT", latMin: 40.98, latMax: 42.05, lonMin: -73.73, lonMax: -71.79 },
  { code: "DE", latMin: 38.45, latMax: 39.84, lonMin: -75.79, lonMax: -75.05 },
  { code: "FL", latMin: 24.52, latMax: 31.00, lonMin: -87.63, lonMax: -80.03 },
  { code: "GA", latMin: 30.36, latMax: 35.00, lonMin: -85.61, lonMax: -80.84 },
  { code: "HI", latMin: 18.91, latMax: 22.24, lonMin: -160.25, lonMax: -154.81 },
  { code: "ID", latMin: 42.00, latMax: 49.00, lonMin: -117.24, lonMax: -111.04 },
  { code: "IL", latMin: 36.97, latMax: 42.51, lonMin: -91.51, lonMax: -87.02 },
  { code: "IN", latMin: 37.77, latMax: 41.76, lonMin: -88.10, lonMax: -84.78 },
  { code: "IA", latMin: 40.37, latMax: 43.50, lonMin: -96.64, lonMax: -90.14 },
  { code: "KS", latMin: 37.00, latMax: 40.00, lonMin: -102.05, lonMax: -94.59 },
  { code: "KY", latMin: 36.50, latMax: 39.15, lonMin: -89.57, lonMax: -81.96 },
  { code: "LA", latMin: 28.93, latMax: 33.02, lonMin: -94.04, lonMax: -88.82 },
  { code: "ME", latMin: 43.06, latMax: 47.46, lonMin: -71.08, lonMax: -66.95 },
  { code: "MD", latMin: 37.91, latMax: 39.72, lonMin: -79.49, lonMax: -75.05 },
  { code: "MA", latMin: 41.24, latMax: 42.89, lonMin: -73.51, lonMax: -69.93 },
  { code: "MI", latMin: 41.70, latMax: 48.31, lonMin: -90.42, lonMax: -82.12 },
  { code: "MN", latMin: 43.50, latMax: 49.38, lonMin: -97.24, lonMax: -89.49 },
  { code: "MS", latMin: 30.17, latMax: 35.00, lonMin: -91.66, lonMax: -88.10 },
  { code: "MO", latMin: 36.00, latMax: 40.61, lonMin: -95.77, lonMax: -89.10 },
  { code: "MT", latMin: 44.36, latMax: 49.00, lonMin: -116.05, lonMax: -104.04 },
  { code: "NE", latMin: 40.00, latMax: 43.00, lonMin: -104.05, lonMax: -95.31 },
  { code: "NV", latMin: 35.00, latMax: 42.00, lonMin: -120.01, lonMax: -114.04 },
  { code: "NH", latMin: 42.70, latMax: 45.31, lonMin: -72.56, lonMax: -70.70 },
  { code: "NJ", latMin: 38.93, latMax: 41.36, lonMin: -75.56, lonMax: -73.89 },
  { code: "NM", latMin: 31.33, latMax: 37.00, lonMin: -109.05, lonMax: -103.00 },
  { code: "NY", latMin: 40.50, latMax: 45.01, lonMin: -79.76, lonMax: -71.86 },
  { code: "NC", latMin: 33.84, latMax: 36.59, lonMin: -84.32, lonMax: -75.46 },
  { code: "ND", latMin: 45.94, latMax: 49.00, lonMin: -104.05, lonMax: -96.55 },
  { code: "OH", latMin: 38.40, latMax: 41.98, lonMin: -84.82, lonMax: -80.52 },
  { code: "OK", latMin: 33.62, latMax: 37.00, lonMin: -103.00, lonMax: -94.43 },
  { code: "OR", latMin: 41.99, latMax: 46.29, lonMin: -124.57, lonMax: -116.46 },
  { code: "PA", latMin: 39.72, latMax: 42.27, lonMin: -80.52, lonMax: -74.69 },
  { code: "RI", latMin: 41.15, latMax: 42.02, lonMin: -71.86, lonMax: -71.12 },
  { code: "SC", latMin: 32.03, latMax: 35.21, lonMin: -83.35, lonMax: -78.54 },
  { code: "SD", latMin: 42.48, latMax: 45.95, lonMin: -104.06, lonMax: -96.44 },
  { code: "TN", latMin: 34.98, latMax: 36.68, lonMin: -90.31, lonMax: -81.65 },
  { code: "TX", latMin: 25.84, latMax: 36.50, lonMin: -106.65, lonMax: -93.51 },
  { code: "UT", latMin: 37.00, latMax: 42.00, lonMin: -114.05, lonMax: -109.04 },
  { code: "VT", latMin: 42.73, latMax: 45.02, lonMin: -73.44, lonMax: -71.46 },
  { code: "VA", latMin: 36.54, latMax: 39.47, lonMin: -83.68, lonMax: -75.24 },
  { code: "WA", latMin: 45.54, latMax: 49.00, lonMin: -124.85, lonMax: -116.92 },
  { code: "WV", latMin: 37.20, latMax: 40.64, lonMin: -82.64, lonMax: -77.72 },
  { code: "WI", latMin: 42.49, latMax: 47.08, lonMin: -92.89, lonMax: -86.25 },
  { code: "WY", latMin: 41.00, latMax: 45.00, lonMin: -111.05, lonMax: -104.05 },
];

export function getStateFromCoordinates(latitude: number, longitude: number): string | null {
  const candidates: StateBounds[] = [];

  for (const state of STATE_BOUNDS) {
    if (
      latitude >= state.latMin &&
      latitude <= state.latMax &&
      longitude >= state.lonMin &&
      longitude <= state.lonMax
    ) {
      candidates.push(state);
    }
  }

  if (candidates.length === 1) {
    return candidates[0].code;
  }

  if (candidates.length > 1) {
    let bestState = candidates[0];
    let bestDist = Infinity;
    for (const state of candidates) {
      const centerLat = (state.latMin + state.latMax) / 2;
      const centerLon = (state.lonMin + state.lonMax) / 2;
      const dist = Math.sqrt(
        Math.pow(latitude - centerLat, 2) + Math.pow(longitude - centerLon, 2)
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestState = state;
      }
    }
    return bestState.code;
  }

  let nearestState = STATE_BOUNDS[0];
  let nearestDist = Infinity;
  for (const state of STATE_BOUNDS) {
    const clampedLat = Math.max(state.latMin, Math.min(state.latMax, latitude));
    const clampedLon = Math.max(state.lonMin, Math.min(state.lonMax, longitude));
    const dist = Math.sqrt(
      Math.pow(latitude - clampedLat, 2) + Math.pow(longitude - clampedLon, 2)
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestState = state;
    }
  }

  if (nearestDist < 1.0) {
    return nearestState.code;
  }

  return null;
}
