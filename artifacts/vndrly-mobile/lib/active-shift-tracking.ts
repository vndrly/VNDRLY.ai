export type ShiftTrackingSnapshot = {
  state: "off_duty" | "tracking" | "paused" | "consent_required";
  sharing: boolean;
  indicator: string | null;
  battery: "normal" | "low";
  location: "current" | "stale";
  activeShiftId: string | null;
};

export function createActiveShiftTracking(options: { consentVersion: number; requiredConsentVersion: number }) {
  let state: ShiftTrackingSnapshot["state"] = "off_duty";
  let battery: ShiftTrackingSnapshot["battery"] = "normal";
  let location: ShiftTrackingSnapshot["location"] = "current";
  let approvedShift = false;
  let activeShiftId: string | null = null;

  const snapshot = (): ShiftTrackingSnapshot => ({
    state,
    sharing: state === "tracking",
    indicator: state === "tracking" ? "Work location sharing on" : null,
    battery,
    location,
    activeShiftId,
  });

  return {
    openApp(_input?: { onDuty?: boolean }) { return snapshot(); },
    shiftStarted(input: { shiftId: string; approved: boolean }) {
      approvedShift = input.approved;
      activeShiftId = input.approved ? input.shiftId : null;
      if (options.consentVersion !== options.requiredConsentVersion) state = "consent_required";
      else state = input.approved ? "tracking" : "off_duty";
      return snapshot();
    },
    shiftEnded() { approvedShift = false; activeShiftId = null; state = "off_duty"; return snapshot(); },
    pause() { if (state === "tracking") state = "paused"; return snapshot(); },
    resume() { if (state === "paused" && approvedShift) state = "tracking"; return snapshot(); },
    health(input: { batteryPercent: number; locationAgeMs: number }) {
      battery = input.batteryPercent <= 15 ? "low" : "normal";
      location = input.locationAgeMs >= 120_000 ? "stale" : "current";
      return snapshot();
    },
    snapshot,
  };
}
