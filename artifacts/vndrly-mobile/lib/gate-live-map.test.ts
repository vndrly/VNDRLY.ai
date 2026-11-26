import { describe, expect, it } from "vitest";
import { ageText, askVMapView, liveMapPoints, mapSummary, ownVisibility, parseSavedMapView, personPosition, personStatus, staffGroups, type LiveCoverage, type LiveStaff } from "./gate-live-map";

const now = Date.parse("2026-11-26T18:00:00Z");
const at = (minutesAgo: number) => ({ latitude: 35.5, longitude: -97.5, accuracy: 8, capturedAt: new Date(now - minutesAgo * 60000).toISOString() });
const person = (userId: number, name: string, extra: Partial<LiveStaff> = {}): LiveStaff => ({ userId, name, assignment: "Site | Main", locationReason: "no_report", fresh: false, location: null, ...extra });
const live = person(1, "Ana Live", { fresh: true, location: at(0), locationReason: "current", onWatch: true });
const last = person(2, "Bo Last", { lastKnownLocation: at(14), locationReason: "stale_or_inaccurate", onCall: true });
const off = person(3, "Cy Off", { locationReason: "sharing_off" });
const sample = person(4, "Di Sample", { demonstration: true, location: at(500), locationReason: "sample_location" });
const coverage: LiveCoverage = {
  gates: [{ id: "g1", name: "Main gate", siteId: 9, siteName: "Site", latitude: 35.4, longitude: -97.4 }, { id: "g2", name: "No fix", siteId: 9, siteName: "Site", latitude: null, longitude: null }],
  staff: [off, last, live, sample],
  duties: [{ id: "d1", userId: 1, stationId: "g1" }],
  pins: [{ id: "p1", label: "Staging", latitude: 35.41, longitude: -97.41 }],
  vehicles: [{ runId: "r1", latitude: 35.42, longitude: -97.42, vehicleLabel: "Truck 7" }],
};

describe("native Gate Map rules", () => {
  it("prefers a current report, then the labeled last known position, and never invents one", () => {
    expect(personPosition(live)?.kind).toBe("live");
    expect(personPosition(last)).toMatchObject({ kind: "last", latitude: 35.5 });
    expect(personPosition(sample)?.kind).toBe("sample");
    expect(personPosition(off)).toBeNull();
    expect(personPosition(person(5, "Stale", { location: at(30) }))).toBeNull();
  });
  it("says how old a position is in plain words", () => {
    expect(ageText(at(0).capturedAt, now)).toBe("just now");
    expect(ageText(at(14).capturedAt, now)).toBe("14 min ago");
    expect(ageText(at(135).capturedAt, now)).toBe("2 h 15 min ago");
    expect(ageText(at(14).capturedAt, now, true)).toBe("hace 14 min");
    expect(personStatus(live, now)).toBe("Live · just now");
    expect(personStatus(last, now)).toBe("Last seen 14 min ago");
    expect(personStatus(off, now)).toBe("Location sharing is off");
    expect(personStatus(person(6, "New"), now)).toBe("No location reported yet");
  });
  it("plots gates, people, pins and vehicles under stable ids and keeps an old pin visibly aged", () => {
    const points = liveMapPoints(coverage, now);
    expect(points.map(point => point.id)).toEqual(["gate:g1", "pin:p1", "vehicle:r1", "staff:2", "staff:1", "staff:4"]);
    expect(points.find(point => point.id === "gate:g1")).toMatchObject({ color: "#0f766e", fullLabel: "Main gate" });
    expect(points.find(point => point.id === "staff:1")).toMatchObject({ color: "#22a565", label: "AL", fullLabel: "Ana" });
    expect(points.find(point => point.id === "staff:2")).toMatchObject({ color: "#d97706", fullLabel: "Bo · 14 min ago" });
  });
  it("groups people like the website map with visible people first", () => {
    const groups = staffGroups(coverage);
    expect(groups.map(group => [group.id, group.people.map(p => p.userId)])).toEqual([["watch", [1]], ["call", [2]], ["other", [4, 3]]]);
    expect(mapSummary(coverage.staff)).toBe("1 live · 1 last seen");
    expect(mapSummary([off])).toBe("No one is sharing a location right now");
  });
  it("tells the worker whether the company can see them", () => {
    expect(ownVisibility(coverage.staff, 1, now)).toEqual({ visible: true, text: "Your company can see you on the map" });
    expect(ownVisibility(coverage.staff, 2, now)).toEqual({ visible: false, text: "Your last report was 14 min ago" });
    expect(ownVisibility(coverage.staff, 3, now)?.text).toContain("Authorize this device in Profile");
    expect(ownVisibility(coverage.staff, 99, now)).toBeNull();
  });
  it("restores only a valid saved camera", () => {
    expect(parseSavedMapView(JSON.stringify({ camera: { center: [-97.5, 35.5], zoom: 16.2 }, styleKind: "street", listOpen: true }))).toEqual({ camera: { center: [-97.5, 35.5], zoom: 16.2 }, styleKind: "street", listOpen: true });
    expect(parseSavedMapView(JSON.stringify({ camera: { center: [-997, 35.5], zoom: 16 } }))).toEqual({ styleKind: "satellite", listOpen: false });
    expect(parseSavedMapView("not json")).toEqual({ styleKind: "satellite", listOpen: false });
    expect(parseSavedMapView(null)).toEqual({ styleKind: "satellite", listOpen: false });
  });
  it("reports an AskV map request truthfully", () => {
    expect(askVMapView({}, coverage, false)).toBeUndefined();
    expect(askVMapView({ staffUserId: "2" }, undefined, false)).toEqual({ target: "staff:2", state: "loading" });
    expect(askVMapView({ staffUserId: "2" }, coverage, false)).toEqual({ target: "staff:2", state: "displayed" });
    expect(askVMapView({ staffUserId: "3" }, coverage, false)).toEqual({ target: "staff:3", state: "unavailable" });
    expect(askVMapView({ reveal: "staff" }, coverage, false)).toEqual({ target: "staff", state: "displayed" });
    expect(askVMapView({ staffUserId: "2" }, undefined, true)).toEqual({ target: "staff:2", state: "error" });
  });
});
