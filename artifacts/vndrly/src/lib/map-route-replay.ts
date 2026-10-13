export type RouteReplayPoint = {
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracyMeters?: number | null;
};
export type RouteReplayEvent = {
  id: string;
  recordedAt: string;
  label: string;
};
export type TimedRoutePoint = RouteReplayPoint & { timeMs: number };
export const ROUTE_GAP_MS = 120_000;
export function normalizeRoutePoints(
  input: readonly RouteReplayPoint[],
): TimedRoutePoint[] {
  const unique = new Map<number, TimedRoutePoint>();
  for (const point of input) {
    const timeMs = Date.parse(point.recordedAt);
    if (
      point.accuracyMeters !== undefined &&
      (point.accuracyMeters === null || point.accuracyMeters > 1000)
    )
      continue;
    if (
      Number.isFinite(timeMs) &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 85 &&
      Math.abs(point.longitude) <= 180
    )
      unique.set(timeMs, { ...point, timeMs });
  }
  return [...unique.values()].sort((a, b) => a.timeMs - b.timeMs);
}
function meters(a: RouteReplayPoint, b: RouteReplayPoint) {
  const radians = (n: number) => (n * Math.PI) / 180;
  const lat = radians(b.latitude - a.latitude),
    lng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function analyzeRoute(input: readonly RouteReplayPoint[]) {
  const points = normalizeRoutePoints(input),
    segments: TimedRoutePoint[][] = [];
  let distanceMeters = 0,
    sampledDurationMs = 0,
    gapCount = 0,
    maxSampledSpeedMps: number | null = null;
  for (const point of points) {
    const previous = segments.at(-1)?.at(-1);
    if (!previous || point.timeMs - previous.timeMs > ROUTE_GAP_MS) {
      if (previous) gapCount++;
      segments.push([point]);
      continue;
    }
    const duration = point.timeMs - previous.timeMs,
      distance = meters(previous, point);
    distanceMeters += distance;
    sampledDurationMs += duration;
    maxSampledSpeedMps = Math.max(
      maxSampledSpeedMps ?? 0,
      distance / (duration / 1000),
    );
    segments.at(-1)!.push(point);
  }
  return {
    points,
    segments,
    distanceMeters,
    sampledDurationMs,
    gapCount,
    startMs: points[0]?.timeMs ?? null,
    endMs: points.at(-1)?.timeMs ?? null,
    durationMs:
      points.length > 1 ? points.at(-1)!.timeMs - points[0].timeMs : 0,
    averageSampledSpeedMps: sampledDurationMs
      ? distanceMeters / (sampledDurationMs / 1000)
      : null,
    maxSampledSpeedMps,
  };
}
/** A missing marker inside a long gap means unknown location, never a guessed path. */
export function routePositionAt(
  points: readonly TimedRoutePoint[],
  timeMs: number,
): { latitude: number; longitude: number; interpolated: boolean } | null {
  if (
    !points.length ||
    !Number.isFinite(timeMs) ||
    timeMs < points[0].timeMs ||
    timeMs > points.at(-1)!.timeMs
  )
    return null;
  const exact = points.find((p) => p.timeMs === timeMs);
  if (exact)
    return {
      latitude: exact.latitude,
      longitude: exact.longitude,
      interpolated: false,
    };
  const right = points.findIndex((p) => p.timeMs > timeMs),
    a = points[right - 1],
    b = points[right];
  if (!a || !b || b.timeMs - a.timeMs > ROUTE_GAP_MS) return null;
  const fraction = (timeMs - a.timeMs) / (b.timeMs - a.timeMs),
    lngDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * fraction,
    longitude: ((a.longitude + lngDelta * fraction + 540) % 360) - 180,
    interpolated: true,
  };
}
export function routeTimecode(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000),
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
