import { describe, expect, it } from "vitest";
import { escalationDue, gatePostPosition } from "./gate-post-policy";
const at = new Date("2026-10-13T12:00:00Z");
const fence = { latitude: 35, longitude: -97, radius: 100 };
const location = { latitude: 35, longitude: -97, accuracy: 5, capturedAt: at.toISOString() };
describe("Gate duty GPS and escalation", () => {
  it("refuses invalid, old, future or inaccurate GPS as departure evidence", () => {
    for (const change of [{ accuracy: -1 }, { accuracy: 101 }, { latitude: NaN }, { longitude: 181 }, { capturedAt: "invalid" }, { capturedAt: "2026-10-13T11:57:00Z" }, { capturedAt: "2026-10-13T12:01:00Z" }]) expect(gatePostPosition({ ...location, ...change }, fence, at)).toBe("unavailable");
    expect(gatePostPosition(location, fence, at)).toBe("inside");
    expect(gatePostPosition({ ...location, latitude: 36 }, fence, at)).toBe("outside");
  });
  it("waits fifteen minutes for unresolved departures and honors active approval", () => {
    const incident = { id: "departure", departedAt: "2026-10-13T11:45:00Z" };
    expect(escalationDue(incident, at)).toBe(true);
    expect(escalationDue(incident, new Date(at.getTime()-1))).toBe(false);
    expect(escalationDue({ ...incident, approvedUntil: "2026-10-13T12:01:00Z" }, at)).toBe(false);
    expect(escalationDue({ ...incident, resolvedAt: at.toISOString() }, at)).toBe(false);
    expect(escalationDue({ ...incident, escalatedAt: at.toISOString() }, at)).toBe(false);
  });
  it("escalates sharing-off only after thirty minutes without supervisor action", () => {
    const incident = { id: "sharing", departedAt: "2026-10-13T11:30:00Z" };
    expect(escalationDue(incident, at, 30, true)).toBe(true);
    expect(escalationDue(incident, new Date(at.getTime()-1), 30, true)).toBe(false);
    expect(escalationDue({ ...incident, acknowledgedAt: at.toISOString() }, at, 30, true)).toBe(false);
  });
});
