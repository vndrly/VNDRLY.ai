// Task #26 — Build the CSV payload for the "Export CSV" button on the
// ticket-detail Timeline & GPS card. Lives in its own helper (instead
// of inlined in the page component) so the row ordering, header
// contract, and Excel-friendly framing (UTF-8 BOM + CRLF) are easy
// to unit-test without spinning up a full ticket page.
//
// Reuses `writeCsv` from `./csv` for cell-level RFC-4180 quoting; we
// only re-join with CRLF here so Excel-on-Windows users opening the
// file directly don't see a single-line blob. The BOM lets Excel
// auto-detect UTF-8 instead of mojibake'ing the timestamp's `Z`
// suffix in some locales.

import { writeCsv } from "./csv";

export type GpsTimelinePoint = {
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

export const GPS_TIMELINE_CSV_HEADER = [
  "point",
  "recordedAt",
  "latitude",
  "longitude",
] as const;

// Mirror the validity filter the timeline component uses
// (`isValidLatLng` in ticket-tracking-timeline.tsx) so the CSV stays
// in lock-step with what the screen renders — a point that's hidden
// from the timeline because its coordinates are nonsense should not
// appear in the export either.
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

// Defensive timestamp coercion: dirty upstream values (empty strings,
// already-parsed dates, malformed ISO) shouldn't blow up the export
// — we'd rather emit an empty `recordedAt` cell than throw and abort
// the whole CSV generation. Returns `null` for unusable input and
// epoch ms for both sort and serialization.
function safeTimeMs(value: GpsTimelinePoint["recordedAt"]): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Serialize the GPS tracking points shown in the on-screen timeline
 * to a downloadable CSV string. Points are emitted in chronological
 * order (matching what the timeline component itself renders), so the
 * first column ("point") aligns with the visual point numbers a
 * reviewer is reading off the page.
 *
 * The output is prefixed with a UTF-8 BOM and uses CRLF line
 * terminators so Windows Excel opens it cleanly when the recipient
 * just double-clicks the file. Points with invalid coordinates or
 * unparseable timestamps are filtered / handled defensively so dirty
 * upstream data never aborts the export.
 */
export function buildGpsTimelineCsv(
  points: ReadonlyArray<GpsTimelinePoint>,
): string {
  const valid = points.filter((p) => isValidLatLng(p.latitude, p.longitude));
  const sorted = valid.slice().sort((a, b) => {
    const at = safeTimeMs(a.recordedAt) ?? 0;
    const bt = safeTimeMs(b.recordedAt) ?? 0;
    return at - bt;
  });
  const rows: string[][] = [Array.from(GPS_TIMELINE_CSV_HEADER)];
  sorted.forEach((p, i) => {
    const ms = safeTimeMs(p.recordedAt);
    rows.push([
      String(i + 1),
      ms != null ? new Date(ms).toISOString() : "",
      String(p.latitude),
      String(p.longitude),
    ]);
  });
  // `writeCsv` joins with `\n` and appends a trailing `\n`. Re-frame
  // with CRLF so Excel-on-Windows opens the file as expected, and
  // prepend the UTF-8 BOM.
  const lfText = writeCsv(rows);
  const crlfText = lfText.replace(/\n/g, "\r\n");
  return `\uFEFF${crlfText}`;
}
