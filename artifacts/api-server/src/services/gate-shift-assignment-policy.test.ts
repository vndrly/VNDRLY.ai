import { describe, expect, it } from "vitest";
import { assertGateShiftAssignmentPolicy } from "./gate-shift-assignment-policy";

const candidate = {
  userId: 18,
  requirements: [
    { code: "Site training", currentRecorded: true, vendorVerified: true },
  ],
  availability: "recorded_available",
  eligibility: { allowed: true, overrideRequired: false },
};

describe("saved Gate assignment evidence", () => {
  it("allows authorized scheduling with overtime alone and preserves other eligibility checks", () => {
    const overtime = {
      ...candidate,
      eligibility: {
        allowed: true,
        overrideRequired: true,
        warnings: ["workforce.overtime_warning"],
      },
    };
    expect(() =>
      assertGateShiftAssignmentPolicy([], [18], [overtime]),
    ).not.toThrow();
    const rest = {
      ...overtime,
      eligibility: {
        ...overtime.eligibility,
        warnings: [
          "workforce.overtime_warning",
          "workforce.rest_window_warning",
        ],
      },
    };
    expect(() => assertGateShiftAssignmentPolicy([], [18], [rest])).toThrow(
      "policy_denied",
    );
    expect(() =>
      assertGateShiftAssignmentPolicy(
        [],
        [18],
        [
          {
            ...overtime,
            eligibility: { ...overtime.eligibility, allowed: false },
          },
        ],
      ),
    ).toThrow("policy_denied");
  });
  it("distinguishes unknown configuration from explicitly empty requirements", () => {
    expect(() =>
      assertGateShiftAssignmentPolicy(null, [18], [candidate]),
    ).toThrow("configuration_unknown");
    expect(() =>
      assertGateShiftAssignmentPolicy(
        [],
        [18],
        [{ ...candidate, requirements: [] }],
      ),
    ).not.toThrow();
  });
  it("requires each configured certification to be current and vendor verified", () => {
    expect(() =>
      assertGateShiftAssignmentPolicy(["Site training"], [18], [candidate]),
    ).not.toThrow();
    for (const change of [
      { currentRecorded: false },
      { vendorVerified: false },
    ]) {
      expect(() =>
        assertGateShiftAssignmentPolicy(
          ["Site training"],
          [18],
          [
            {
              ...candidate,
              requirements: [{ ...candidate.requirements[0], ...change }],
            },
          ],
        ),
      ).toThrow("qualification_required");
    }
    expect(() =>
      assertGateShiftAssignmentPolicy(["Other training"], [18], [candidate]),
    ).toThrow("qualification_required");
  });
  it("allows assignments without recorded availability", () => {
    for (const availability of [
      "recorded_available",
      "unknown_no_window",
      "unknown_recurrence",
      "recorded_conflict",
    ]) {
      expect(() =>
        assertGateShiftAssignmentPolicy(
          [],
          [18],
          [{ ...candidate, availability }],
        ),
      ).not.toThrow();
    }
  });
  it("preserves assignment policy denials independently of calendar availability", () => {
    expect(() =>
      assertGateShiftAssignmentPolicy(
        [],
        [18],
        [
          {
            ...candidate,
            eligibility: { allowed: false, overrideRequired: false },
          },
        ],
      ),
    ).toThrow("policy_denied");
    expect(() =>
      assertGateShiftAssignmentPolicy(
        [],
        [18],
        [
          {
            ...candidate,
            eligibility: { allowed: true, overrideRequired: true },
          },
        ],
      ),
    ).toThrow("policy_denied");
  });
  it("does not let a same-name or foreign user replace exact eligible membership", () => {
    expect(() =>
      assertGateShiftAssignmentPolicy([], [19], [candidate]),
    ).toThrow("candidate_unavailable");
    expect(() => assertGateShiftAssignmentPolicy(null, [], [])).not.toThrow();
  });
});
