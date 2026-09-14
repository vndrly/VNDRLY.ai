import { describe, expect, it } from "vitest";
import { createActiveShiftTracking } from "./active-shift-tracking";

describe("active shift tracking", () => {
  it("starts automatically only during an eligible shift after versioned consent", () => {
    const tracking = createActiveShiftTracking({ consentVersion: 2, requiredConsentVersion: 2 });
    expect(tracking.openApp({ onDuty: false })).toMatchObject({ state: "off_duty", sharing: false });
    expect(tracking.shiftStarted({ shiftId: "shift-1", approved: true })).toMatchObject({ state: "tracking", sharing: true, indicator: "Work location sharing on" });
    expect(tracking.shiftEnded()).toMatchObject({ state: "off_duty", sharing: false });
  });

  it("surfaces paused, stale, battery, and location health", () => {
    const tracking = createActiveShiftTracking({ consentVersion: 1, requiredConsentVersion: 1 });
    tracking.shiftStarted({ shiftId: "shift-1", approved: true });
    expect(tracking.health({ batteryPercent: 8, locationAgeMs: 180_000 })).toMatchObject({ battery: "low", location: "stale" });
    expect(tracking.pause()).toMatchObject({ state: "paused", sharing: false });
  });

  it("blocks tracking when consent is missing or the shift is unapproved", () => {
    expect(createActiveShiftTracking({ consentVersion: 1, requiredConsentVersion: 2 }).shiftStarted({ shiftId: "shift-1", approved: true })).toMatchObject({ state: "consent_required", sharing: false });
    expect(createActiveShiftTracking({ consentVersion: 2, requiredConsentVersion: 2 }).shiftStarted({ shiftId: "shift-1", approved: false })).toMatchObject({ state: "off_duty", sharing: false });
  });
});
