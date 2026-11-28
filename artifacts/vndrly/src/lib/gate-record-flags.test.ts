import { describe, expect, it } from "vitest";
import { gateRecordFlags } from "./gate-record-flags";

const start = "2026-10-28T08:00:00Z";
describe("Gate record flags", () => {
  it("stacks missing GPS and overdue time, with total time on site in hh:mm", () => {
    const flags = gateRecordFlags({ checkInTime: start, expectedMinutes: 240, checkInGpsEvidence: { status: "unavailable" } }, false, Date.parse("2026-10-28T13:23:00Z"));
    expect(flags.map(flag => flag.label)).toEqual(["Location Flag: No GPS", "Location Flag: Duration Time On Site 05:23 Overdue"]);
  });
  it("freezes departure duration and handles watches longer than a day", () => {
    const record = { checkInTime: start, checkOutTime: "2026-10-29T10:05:00Z", expectedMinutes: 600 };
    expect(gateRecordFlags(record, false, Date.parse("2026-11-01T00:00:00Z"))[0].label).toContain("26:05 Overdue");
  });
  it("does not invent overdue time for pending entries or an unknown departure", () => {
    const record = { checkInTime: start, expectedMinutes: 1 };
    expect(gateRecordFlags({ ...record, admissionStatus: "pending" })).toEqual([]);
    expect(gateRecordFlags({ ...record, reconciliationState: "confirmed_off_site" })).toEqual([]);
    expect(gateRecordFlags({ ...record, checkOutTime: "2026-10-28T08:00:30Z" })).toEqual([]);
  });
  it("deduplicates the same GPS problem while retaining both evidence sources", () => {
    const flags = gateRecordFlags({ checkInGpsEvidence: { status: "mismatch", distanceMeters: 750 }, checkOutGpsEvidence: { status: "mismatch", distanceMeters: 650 } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ label: "Location Flag: Outside geofence", title: "Check-in · 750 m; Check-out · 650 m" });
    expect(gateRecordFlags({ checkInGpsEvidence: { status: "verified" } })).toEqual([]);
    // The review reason saved with an outside-geofence crossing is not shown a second time beside the location flag.
    expect(gateRecordFlags({ checkInGpsEvidence: { status: "mismatch", distanceMeters: 750 }, conflictReason: "Outside geofence at check-in\nMissing company" }).map(flag => flag.label))
      .toEqual(["Location Flag: Outside geofence", "Flag: Missing company"]);
  });
  it("shows the boss which crossings were recorded from a laptop with no GPS, and stops once the phone is back", () => {
    const noGps = { status: "unavailable", gateName: "Main Gate" }, verified = { status: "verified", gateName: "Main Gate" };
    // In and out with no GPS: one flag that names both crossings.
    expect(gateRecordFlags({ checkInGpsEvidence: noGps, checkOutGpsEvidence: noGps }))
      .toEqual([{ key: "unavailable", label: "Location Flag: No GPS", title: "Check-in · Main Gate; Check-out · Main Gate" }]);
    // In with no GPS, out after the phone charged: the flag names the check-in only.
    expect(gateRecordFlags({ checkInGpsEvidence: noGps, checkOutGpsEvidence: verified }))
      .toEqual([{ key: "unavailable", label: "Location Flag: No GPS", title: "Check-in · Main Gate" }]);
    // Recorded with GPS: no flag.
    expect(gateRecordFlags({ checkInGpsEvidence: verified, checkOutGpsEvidence: verified })).toEqual([]);
    // The review reason saved with a no-GPS crossing is not shown a second time beside the location flag.
    expect(gateRecordFlags({ checkInGpsEvidence: noGps, conflictReason: "Missing company\nNo GPS at check-in" }).map(flag => flag.label))
      .toEqual(["Location Flag: No GPS", "Flag: Missing company"]);
  });
  it("does not turn a routing outage into a missing GPS flag", () => {
    expect(gateRecordFlags({ etaUnavailableReason: "gate_arrivals.route_unavailable" })).toEqual([]);
    expect(gateRecordFlags({ etaUnavailableReason: "gate_arrivals.location_unavailable" })[0].label).toBe("Location Flag: No GPS");
  });
});
