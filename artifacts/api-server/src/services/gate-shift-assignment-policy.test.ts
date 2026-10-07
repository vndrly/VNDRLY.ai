import { describe, expect, it } from "vitest";
import { assertGateShiftAssignmentPolicy } from "./gate-shift-assignment-policy";

const candidate = {
  userId: 18,
  requirements: [{ code: "Site training", currentRecorded: true, vendorVerified: true }],
  availability: "recorded_available",
  eligibility: { allowed: true, overrideRequired: false },
};

describe("saved Gate assignment evidence", () => {
  it("distinguishes unknown configuration from explicitly empty requirements", () => {
    expect(() => assertGateShiftAssignmentPolicy(null, [18], [candidate])).toThrow("configuration_unknown");
    expect(() => assertGateShiftAssignmentPolicy([], [18], [{ ...candidate, requirements: [] }])).not.toThrow();
  });
  it("requires each configured certification to be current and vendor verified", () => {
    expect(() => assertGateShiftAssignmentPolicy(["Site training"], [18], [candidate])).not.toThrow();
    for (const change of [{ currentRecorded: false }, { vendorVerified: false }]) {
      expect(() => assertGateShiftAssignmentPolicy(["Site training"], [18], [{
        ...candidate, requirements: [{ ...candidate.requirements[0], ...change }],
      }])).toThrow("qualification_required");
    }
    expect(() => assertGateShiftAssignmentPolicy(["Other training"], [18], [candidate])).toThrow("qualification_required");
  });
  it("refuses unknown, recurring and conflicting availability and policy overrides", () => {
    for (const availability of ["unknown_no_window", "unknown_recurrence", "recorded_conflict"]) {
      expect(() => assertGateShiftAssignmentPolicy([], [18], [{ ...candidate, availability }])).toThrow("availability_required");
    }
    expect(() => assertGateShiftAssignmentPolicy([], [18], [{ ...candidate, eligibility: { allowed: true, overrideRequired: true } }])).toThrow("policy_denied");
  });
  it("does not let a same-name or foreign user replace exact eligible membership", () => {
    expect(() => assertGateShiftAssignmentPolicy([], [19], [candidate])).toThrow("candidate_unavailable");
    expect(() => assertGateShiftAssignmentPolicy(null, [], [])).not.toThrow();
  });
});
