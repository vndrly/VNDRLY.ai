import { haversineMeters } from "@workspace/map-utils";

export function minutesBetween(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): number | null {
  if (start == null || end == null) return null;
  const a = start instanceof Date ? start : new Date(start);
  const b = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

export function pickReplayDate(
  checkInTime: Date | null,
  enRouteAt: Date | null,
  arrivedAt: Date | null,
  updatedAt: Date | null,
): string {
  const ref = checkInTime ?? arrivedAt ?? enRouteAt ?? updatedAt ?? new Date();
  return ref.toISOString().slice(0, 10);
}

export function computeOnSiteMinutes(row: {
  checkInTime: Date | null;
  checkOutTime: Date | null;
  arrivedAt: Date | null;
}): number | null {
  const start = row.checkInTime ?? row.arrivedAt;
  if (!start) return null;
  const end = row.checkOutTime ?? new Date();
  return minutesBetween(start, end);
}

export function computeTravelMinutes(row: {
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  checkInTime: Date | null;
  onLocationAt: Date | null;
}): number | null {
  if (!row.enRouteAt) return null;
  const arrived = row.arrivedAt ?? row.checkInTime ?? row.onLocationAt;
  if (!arrived) return null;
  return minutesBetween(row.enRouteAt, arrived);
}

export function checkInDistanceMeters(row: {
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
}): number | null {
  if (
    row.checkInLatitude == null ||
    row.checkInLongitude == null ||
    row.siteLatitude == null ||
    row.siteLongitude == null
  ) {
    return null;
  }
  return Math.round(
    haversineMeters(
      row.checkInLatitude,
      row.checkInLongitude,
      row.siteLatitude,
      row.siteLongitude,
    ),
  );
}
