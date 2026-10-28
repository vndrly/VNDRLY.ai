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
  });
  it("does not turn a routing outage into a missing GPS flag", () => {
    expect(gateRecordFlags({ etaUnavailableReason: "gate_arrivals.route_unavailable" })).toEqual([]);
    expect(gateRecordFlags({ etaUnavailableReason: "gate_arrivals.location_unavailable" })[0].label).toBe("Location Flag: No GPS");
  });
});
