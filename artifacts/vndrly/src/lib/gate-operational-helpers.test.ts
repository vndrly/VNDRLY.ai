import { expect, it } from "vitest";
import { gateHelperDefinition, findGateHelperForQuestion } from "./gate-helper-registry";
import { gateGuideMatches, gateCheckInTarget, gateMovementTarget, gateStaffingTarget } from "./gate-operational-helpers";

const context = { siteId: 21, stationId: "west", siteName: "West site", stationName: "West Gate", shiftId: "night", day: "2026-11-09", vehicleId: 42 };
const selected = (id: string, patch = {}) => ({ id, context: { ...context, ...patch } });
it("registers operational Gate lessons on demand with exact site/station/calendar destinations", () => {
  expect(gateHelperDefinition("gate-shift-scheduling")?.access).toBe("office");
  expect(gateHelperDefinition("gate-inner-arrival")?.access).toBe("gate");
  expect(gateHelperDefinition("gate-staffing-recovery")?.create(context)?.action?.href).toBe("/work-hub/calendar?siteId=21&stationId=west&shiftId=night&date=2026-11-09");
  expect(gateHelperDefinition("gate-return-to-inner")?.create(context)?.action?.href).toBe("/gate?siteId=21&stationId=west&vehicleId=42");
  expect(findGateHelperForQuestion("help me confirm an inner arrival")?.key).toBe("gate-inner-arrival");
  expect(findGateHelperForQuestion("show the gate map and log")?.key).toBe("gate-map-and-log");
});
it("never points at a different saved gate or an arbitrarily chosen vehicle", () => {
  expect(gateGuideMatches(selected("gate-inner-arrival"), "gate-inner-arrival", context)).toBe(true);
  expect(gateGuideMatches(selected("gate-inner-arrival", { stationId: "east" }), "gate-inner-arrival", context)).toBe(false);
  expect(gateGuideMatches(selected("gate-inner-arrival", { vehicleId: 43 }), "gate-inner-arrival", context)).toBe(false);
  expect(gateGuideMatches(selected("gate-inner-arrival", { vehicleId: undefined }), "gate-inner-arrival", context)).toBe(false);
  expect(gateGuideMatches(null, "gate-inner-arrival", context)).toBe(false);
  expect(gateGuideMatches(selected("gate-staffing-recovery"), "gate-staffing-recovery", { ...context, alertId: "saved-gap" })).toBe(false);
  expect(gateGuideMatches(selected("gate-staffing-recovery", { alertId: "saved-gap" }), "gate-staffing-recovery", { ...context, alertId: "saved-gap" })).toBe(true);
});
it("guides the real required check-in controls and pauses on offline/unavailable reads", () => {
  expect(gateCheckInTarget({ firstName: "", lastName: "", plate: "", gateReady: true, online: true })?.targetId).toBe("plate");
  expect(gateCheckInTarget({ firstName: "", lastName: "", plate: "ABC123", gateReady: true, online: true })?.targetId).toBe("first-name");
  expect(gateCheckInTarget({ firstName: "Casey", lastName: "Reed", plate: "ABC123", gateReady: true, online: true })?.targetId).toBe("save-check-in");
  expect(gateCheckInTarget({ firstName: "Casey", lastName: "Reed", plate: "ABC123", gateReady: true, online: false })).toBeNull();
});
it.each([
  ["gate-inner-arrival", { inner: true, inside: false, expectedHere: true }, "enter"],
  ["gate-vehicle-check-out", { inner: true, inside: true }, "leave"],
  ["gate-vehicle-check-out", { inner: false, inside: false, expectedSiteExit: true }, "site-exit"],
  ["gate-early-turnaround", { inner: false, inside: false, expectedInner: true }, "site-exit"],
  ["gate-return-to-inner", { inner: true, inside: false, previouslyEntered: true, showAll: false }, "find-vehicle"],
  ["gate-return-to-inner", { inner: true, inside: false, previouslyEntered: true, showAll: true }, "enter"],
] as const)("points %s only at its real saved movement control", (key, facts, targetId) => {
  expect(gateMovementTarget(key, { open: true, online: true, canManage: true, ...facts })?.targetId).toBe(targetId);
  expect(gateMovementTarget(key, { open: true, online: false, canManage: true, ...facts })).toBeNull();
  expect(gateMovementTarget(key, { open: false, online: true, canManage: true, ...facts })).toBeNull();
});
it("distinguishes unresolved coverage, saved acknowledgment and a future warning", () => {
  expect(gateStaffingTarget({ status: "open", severity: "critical", canAcknowledge: true })?.targetId).toBe("acknowledge");
  expect(gateStaffingTarget({ status: "acknowledged", severity: "critical", canAcknowledge: true })?.targetId).toBe("calendar");
  expect(gateStaffingTarget({ status: "open", severity: "warning", canAcknowledge: true })?.prompt).toContain("upcoming");
  expect(gateStaffingTarget({ status: "resolved", severity: "critical", canAcknowledge: true })).toBeNull();
});
