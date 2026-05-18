import { describe, it, expect } from "vitest";
import {
  buildGpsTimelineCsv,
  GPS_TIMELINE_CSV_HEADER,
  type GpsTimelinePoint,
} from "./gps-timeline-csv";

describe("buildGpsTimelineCsv", () => {
  it("emits the documented header in the documented column order", () => {
    const csv = buildGpsTimelineCsv([]);
    // BOM + header + trailing CRLF.
    expect(csv).toBe(`\uFEFF${GPS_TIMELINE_CSV_HEADER.join(",")}\r\n`);
  });

  it("sorts points chronologically and numbers them from 1", () => {
    const points: GpsTimelinePoint[] = [
      { latitude: 30.5, longitude: -95.5, recordedAt: "2024-01-01T00:02:00Z" },
      { latitude: 30.1, longitude: -95.1, recordedAt: "2024-01-01T00:00:00Z" },
      { latitude: 30.3, longitude: -95.3, recordedAt: "2024-01-01T00:01:00Z" },
    ];
    const csv = buildGpsTimelineCsv(points);
    // Strip BOM, split lines (CRLF), drop trailing blank from final \r\n.
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toEqual([
      "point,recordedAt,latitude,longitude",
      "1,2024-01-01T00:00:00.000Z,30.1,-95.1",
      "2,2024-01-01T00:01:00.000Z,30.3,-95.3",
      "3,2024-01-01T00:02:00.000Z,30.5,-95.5",
    ]);
  });

  it("normalizes timestamps to ISO 8601 in UTC", () => {
    // Date input with a non-UTC offset gets converted to UTC ISO.
    const points: GpsTimelinePoint[] = [
      {
        latitude: 1.234567,
        longitude: -2.345678,
        recordedAt: new Date("2024-06-15T12:30:00-05:00"),
      },
    ];
    const csv = buildGpsTimelineCsv(points);
    expect(csv).toContain(",2024-06-15T17:30:00.000Z,1.234567,-2.345678");
  });

  it("emits an empty recordedAt cell when the point has none", () => {
    const csv = buildGpsTimelineCsv([
      { latitude: 10, longitude: 20, recordedAt: null },
    ]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[1]).toBe("1,,10,20");
  });

  it("preserves original input order when no recordedAt is set", () => {
    const points: GpsTimelinePoint[] = [
      { latitude: 1, longitude: 1, recordedAt: null },
      { latitude: 2, longitude: 2, recordedAt: null },
      { latitude: 3, longitude: 3, recordedAt: null },
    ];
    const csv = buildGpsTimelineCsv(points);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toEqual([
      "point,recordedAt,latitude,longitude",
      "1,,1,1",
      "2,,2,2",
      "3,,3,3",
    ]);
  });

  it("starts with a UTF-8 BOM so Excel auto-detects encoding", () => {
    const csv = buildGpsTimelineCsv([
      { latitude: 0, longitude: 0, recordedAt: "2024-01-01T00:00:00Z" },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("uses CRLF line endings for Excel-on-Windows compatibility", () => {
    const csv = buildGpsTimelineCsv([
      { latitude: 0, longitude: 0, recordedAt: "2024-01-01T00:00:00Z" },
    ]);
    // Should contain \r\n separators and end with one.
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    // Should never contain a bare \n that isn't preceded by \r.
    expect(/(?<!\r)\n/.test(csv)).toBe(false);
  });

  it("does not mutate the input array", () => {
    const points: GpsTimelinePoint[] = [
      { latitude: 1, longitude: 1, recordedAt: "2024-01-01T00:01:00Z" },
      { latitude: 2, longitude: 2, recordedAt: "2024-01-01T00:00:00Z" },
    ];
    const snapshot = points.map((p) => ({ ...p }));
    buildGpsTimelineCsv(points);
    expect(points).toEqual(snapshot);
  });

  it("drops points with invalid coordinates so the CSV mirrors the on-screen timeline", () => {
    const points: GpsTimelinePoint[] = [
      { latitude: 30.1, longitude: -95.1, recordedAt: "2024-01-01T00:00:00Z" },
      // out of range latitude
      { latitude: 91, longitude: 0, recordedAt: "2024-01-01T00:01:00Z" },
      // out of range longitude
      { latitude: 0, longitude: 181, recordedAt: "2024-01-01T00:02:00Z" },
      // NaN
      { latitude: NaN, longitude: 0, recordedAt: "2024-01-01T00:03:00Z" },
      { latitude: 30.2, longitude: -95.2, recordedAt: "2024-01-01T00:04:00Z" },
    ];
    const csv = buildGpsTimelineCsv(points);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toEqual([
      "point,recordedAt,latitude,longitude",
      "1,2024-01-01T00:00:00.000Z,30.1,-95.1",
      "2,2024-01-01T00:04:00.000Z,30.2,-95.2",
    ]);
  });

  it("does not throw on an unparseable recordedAt — emits an empty cell instead", () => {
    const points: GpsTimelinePoint[] = [
      { latitude: 1, longitude: 1, recordedAt: "not-a-date" },
      { latitude: 2, longitude: 2, recordedAt: "2024-01-01T00:00:00Z" },
    ];
    expect(() => buildGpsTimelineCsv(points)).not.toThrow();
    const csv = buildGpsTimelineCsv(points);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    // Unparseable dates sort as 0 (epoch start) so they end up first.
    expect(lines).toEqual([
      "point,recordedAt,latitude,longitude",
      "1,,1,1",
      "2,2024-01-01T00:00:00.000Z,2,2",
    ]);
  });
});
