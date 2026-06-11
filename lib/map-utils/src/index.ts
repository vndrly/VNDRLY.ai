/** Shared map / geofence / live-crew helpers for web, mobile, and API. */

export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;
export const DEFAULT_SITE_CREATE_RADIUS_METERS = 1609;
export const QUARTER_MILE_METERS = 402.336;
export const MAX_RADIUS_METERS = 5000;
export const LIVE_PING_FRESH_MS = 15 * 60_000;
export const LOW_BATTERY_THRESHOLD = 0.2;
export const ETA_DEFAULT_MPH = 31;
export const SPEED_MIN_MOVING_MPS = 1.8;
export const AT_SITE_RADIUS_M = DEFAULT_GEOFENCE_RADIUS_METERS;
export const METERS_PER_MILE = 1609.344;
export const MPS_TO_MPH = 2.23694;
export const STALE_PING_MS = 5 * 60_000;
export const PROBLEM_ETA_MINUTES = 90;

export function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Resolve geofence radius: explicit site value, else fallback (150 m). */
export function resolveGeofenceRadiusMeters(
  siteRadiusMeters: number | null | undefined,
  fallback = DEFAULT_GEOFENCE_RADIUS_METERS,
): number {
  const n = siteRadiusMeters == null ? NaN : Number(siteRadiusMeters);
  if (Number.isFinite(n) && n > 0) return Math.min(n, MAX_RADIUS_METERS);
  return fallback;
}

/** Site-map search ring: prefer configured site radius, else quarter mile. */
export function resolveSiteMapRadiusMeters(
  siteRadiusMeters: number | null | undefined,
  queryOverride?: number | null,
): number {
  if (queryOverride != null && Number.isFinite(queryOverride) && queryOverride > 0) {
    return Math.min(queryOverride, MAX_RADIUS_METERS);
  }
  const configured = resolveGeofenceRadiusMeters(siteRadiusMeters, QUARTER_MILE_METERS);
  return configured;
}

export function lifecyclePinColor(lifecycleState: string | null | undefined): string {
  if (lifecycleState === "en_route") return "#f59e0b";
  if (lifecycleState === "on_location") return "#6366f1";
  if (lifecycleState === "on_site") return "#10b981";
  return "#0ea5e9";
}

export function etaMinutes(
  fromLat: number,
  fromLng: number,
  siteLat: number | null,
  siteLng: number | null,
  speedMps: number | null,
  atSiteRadiusM = AT_SITE_RADIUS_M,
): { meters: number; minutes: number } | null {
  if (siteLat == null || siteLng == null) return null;
  const meters = haversineMeters(fromLat, fromLng, siteLat, siteLng);
  if (meters < atSiteRadiusM) return { meters, minutes: 0 };
  const mph =
    speedMps != null && speedMps >= SPEED_MIN_MOVING_MPS
      ? speedMps * MPS_TO_MPH
      : ETA_DEFAULT_MPH;
  const minutes = (meters / METERS_PER_MILE / mph) * 60;
  return { meters, minutes };
}

export type ProblemCrewInput = {
  batteryLevel: number | null;
  recordedAt: string;
  lifecycleState: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  latitude: number;
  longitude: number;
  speedMps: number | null;
};

export function isProblemCrewMember(loc: ProblemCrewInput, nowMs = Date.now()): boolean {
  if (loc.batteryLevel != null && loc.batteryLevel <= LOW_BATTERY_THRESHOLD) return true;
  const age = nowMs - new Date(loc.recordedAt).getTime();
  if (age > STALE_PING_MS) return true;
  if (loc.lifecycleState === "en_route") {
    const eta = etaMinutes(
      loc.latitude,
      loc.longitude,
      loc.siteLatitude,
      loc.siteLongitude,
      loc.speedMps,
    );
    if (eta && eta.minutes >= PROBLEM_ETA_MINUTES) return true;
  }
  return false;
}

export type ClusterPin = {
  id: string | number;
  latitude: number;
  longitude: number;
};

export type PinCluster = {
  latitude: number;
  longitude: number;
  count: number;
  members: ClusterPin[];
};

/** Simple grid clustering by haversine distance (meters). */
export function clusterPins(
  pins: ClusterPin[],
  clusterRadiusMeters = 400,
): PinCluster[] {
  const clusters: PinCluster[] = [];
  for (const pin of pins) {
    let merged = false;
    for (const cluster of clusters) {
      const d = haversineMeters(
        pin.latitude,
        pin.longitude,
        cluster.latitude,
        cluster.longitude,
      );
      if (d <= clusterRadiusMeters) {
        const n = cluster.count + 1;
        cluster.latitude =
          (cluster.latitude * cluster.count + pin.latitude) / n;
        cluster.longitude =
          (cluster.longitude * cluster.count + pin.longitude) / n;
        cluster.count = n;
        cluster.members.push(pin);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        latitude: pin.latitude,
        longitude: pin.longitude,
        count: 1,
        members: [pin],
      });
    }
  }
  return clusters;
}

export function carSvg(color: string, headingKnown: boolean): string {
  const opacity = headingKnown ? 1 : 0.78;
  return `
    <svg viewBox="-20 -28 40 56" width="40" height="56" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity};filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));">
      <rect x="-10" y="-22" width="20" height="44" rx="6" ry="8" fill="${color}" stroke="white" stroke-width="1.5"/>
      <path d="M-8 -12 L8 -12 L6 -19 L-6 -19 Z" fill="rgba(255,255,255,.85)"/>
      <path d="M-7 14 L7 14 L6 19 L-6 19 Z" fill="rgba(255,255,255,.55)"/>
      <rect x="-12" y="-10" width="2.5" height="3" fill="${color}" stroke="white" stroke-width="0.6"/>
      <rect x="9.5" y="-10" width="2.5" height="3" fill="${color}" stroke="white" stroke-width="0.6"/>
      <circle cx="0" cy="-23" r="1.6" fill="#fef3c7"/>
    </svg>`;
}

export function buildCarPinHtml(opts: {
  color: string;
  heading: number | null;
  lowBattery?: boolean;
  lowBatteryTitle?: string;
  testId?: string;
  employeeId?: number;
  flashing?: boolean;
}): string {
  const rotation = opts.heading != null ? opts.heading : 0;
  const badge = opts.lowBattery
    ? `<div title="${opts.lowBatteryTitle ?? "Low battery"}" style="position:absolute;right:-2px;top:-2px;width:14px;height:14px;border-radius:50%;background:#dc2626;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;font-family:sans-serif;line-height:1;z-index:2;">!</div>`
    : "";
  const ring = opts.flashing
    ? `<div class="lifecycle-flash-pin-ring" aria-hidden="true"></div>`
    : "";
  const attrs = [
    opts.testId ? `data-testid="${opts.testId}"` : "",
    opts.employeeId != null ? `data-employee-id="${opts.employeeId}"` : "",
    opts.heading != null ? `data-heading="${Math.round(opts.heading)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div ${attrs} style="position:relative;width:40px;height:56px;transform:translate(-20px,-28px);overflow:visible;">
      ${ring}
      <div style="position:absolute;inset:0;transform:rotate(${rotation}deg);transform-origin:50% 50%;z-index:2;">
        ${carSvg(opts.color, opts.heading != null)}
      </div>
      ${badge}
    </div>`;
}
