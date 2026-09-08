export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type RouteEstimate = {
  provider: "mapbox";
  trafficAware: boolean;
  distanceMiles: number;
  durationMinutes: number;
  routeConfidence: "high" | "medium" | "low";
};

export type RouteEstimateResult =
  | ({ ok: true } & RouteEstimate)
  | { ok: false; errorCode: "mapbox.missing_token" | "mapbox.request_failed" | "mapbox.no_route"; message: string };

type EstimateArgs = {
  origin: RouteCoordinate;
  destination: RouteCoordinate;
};

type EstimateOptions = {
  accessToken?: string | null;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
};

const METERS_PER_MILE = 1609.344;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

type CacheEntry = {
  expiresAt: number;
  result: RouteEstimateResult;
};

const routeCache = new Map<string, CacheEntry>();
const inFlightRoutes = new Map<string, Promise<RouteEstimateResult>>();

export function clearMapboxRouteCache(): void {
  routeCache.clear();
  inFlightRoutes.clear();
}

function isFiniteCoordinate(coord: RouteCoordinate): boolean {
  return (
    Number.isFinite(coord.latitude) &&
    Number.isFinite(coord.longitude) &&
    coord.latitude >= -90 &&
    coord.latitude <= 90 &&
    coord.longitude >= -180 &&
    coord.longitude <= 180
  );
}

function roundedCoordinate(coord: RouteCoordinate): string {
  return `${coord.latitude.toFixed(5)},${coord.longitude.toFixed(5)}`;
}

function routeCacheKey(args: EstimateArgs): string {
  return `${roundedCoordinate(args.origin)}>${roundedCoordinate(args.destination)}`;
}

function cacheTtl(options: EstimateOptions): number {
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
}

function rememberRouteEstimate(key: string, result: RouteEstimateResult, ttlMs: number): void {
  if (!result.ok || ttlMs <= 0) return;
  routeCache.set(key, { result, expiresAt: Date.now() + ttlMs });
  if (routeCache.size > MAX_CACHE_ENTRIES) {
    const oldest = routeCache.keys().next().value;
    if (oldest) routeCache.delete(oldest);
  }
}

export async function estimateMapboxDrivingRoute(
  args: EstimateArgs,
  options: EstimateOptions = {},
): Promise<RouteEstimateResult> {
  const accessToken = options.accessToken ?? process.env.MAPBOX_ACCESS_TOKEN ?? process.env.MAPBOX_API_KEY ?? process.env.VITE_MAPBOX_ACCESS_TOKEN ?? "";
  if (!accessToken.trim()) {
    return {
      ok: false,
      errorCode: "mapbox.missing_token",
      message: "Mapbox routing is not configured.",
    };
  }
  if (!isFiniteCoordinate(args.origin) || !isFiniteCoordinate(args.destination)) {
    return {
      ok: false,
      errorCode: "mapbox.no_route",
      message: "Route coordinates are invalid.",
    };
  }

  const ttlMs = cacheTtl(options);
  const key = routeCacheKey(args);
  if (ttlMs > 0) {
    const cached = routeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) routeCache.delete(key);
    const inFlight = inFlightRoutes.get(key);
    if (inFlight) return inFlight;
  }

  const estimate = requestMapboxDrivingRoute(args, accessToken, options);
  if (ttlMs <= 0) return estimate;

  inFlightRoutes.set(key, estimate);
  try {
    const result = await estimate;
    rememberRouteEstimate(key, result, ttlMs);
    return result;
  } finally {
    inFlightRoutes.delete(key);
  }
}

async function requestMapboxDrivingRoute(
  args: EstimateArgs,
  accessToken: string,
  options: EstimateOptions,
): Promise<RouteEstimateResult> {
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${args.origin.longitude},${args.origin.latitude};${args.destination.longitude},${args.destination.latitude}`,
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("geometries", "geojson");

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch {
    return {
      ok: false,
      errorCode: "mapbox.request_failed",
      message: "Mapbox routing request failed.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      errorCode: "mapbox.request_failed",
      message: `Mapbox routing returned HTTP ${response.status}.`,
    };
  }

  const body = (await response.json()) as {
    routes?: Array<{ distance?: unknown; duration?: unknown }>;
  };
  const route = body.routes?.[0];
  const distanceMeters = typeof route?.distance === "number" ? route.distance : null;
  const durationSeconds = typeof route?.duration === "number" ? route.duration : null;
  if (distanceMeters == null || durationSeconds == null) {
    return {
      ok: false,
      errorCode: "mapbox.no_route",
      message: "Mapbox did not return a route.",
    };
  }

  return {
    ok: true,
    provider: "mapbox",
    trafficAware: true,
    distanceMiles: Math.round((distanceMeters / METERS_PER_MILE) * 10) / 10,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    routeConfidence: "high",
  };
}
