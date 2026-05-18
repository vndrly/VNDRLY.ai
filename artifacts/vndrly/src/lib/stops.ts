export type StopTrackingPoint = {
  id?: number | string;
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

export type DerivedStop = {
  index: number;
  startPoint: StopTrackingPoint;
  endPoint: StopTrackingPoint;
  startTime: Date | null;
  durationMs: number;
};

export const LONG_DWELL_MS = 5 * 60 * 1000;

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function deriveLongStops(
  tracking?: StopTrackingPoint[],
  thresholdMs: number = LONG_DWELL_MS,
): DerivedStop[] {
  if (!tracking || tracking.length === 0) return [];
  const sorted = tracking
    .filter((p) => isValidLatLng(p.latitude, p.longitude))
    .slice()
    .sort((a, b) => {
      const at = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
      const bt = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
      return at - bt;
    });

  const out: DerivedStop[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const t = cur.recordedAt ? new Date(cur.recordedAt).getTime() : NaN;
    const pt = prev.recordedAt ? new Date(prev.recordedAt).getTime() : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(pt)) continue;
    const diff = t - pt;
    if (diff >= thresholdMs) {
      out.push({
        index: i,
        startPoint: prev,
        endPoint: cur,
        startTime: prev.recordedAt ? new Date(prev.recordedAt) : null,
        durationMs: diff,
      });
    }
  }
  return out;
}

export function formatDwell(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
