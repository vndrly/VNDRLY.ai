import { describe, expect, it } from "vitest";
import {
  assignmentAcknowledgementDeadline,
  coverageEscalationDelayMs,
  evaluateAssignmentEligibility,
  evaluateNoShow,
  workforceReminderSchedule,
} from "./workforce-coverage";

const at = (value: string) => new Date(value);

describe("Implementation A workforce coverage rules", () => {
  it("uses the approved acknowledgement deadlines", () => {
    const assignedAt = at("2026-09-13T12:00:00.000Z");
    expect(assignmentAcknowledgementDeadline(assignedAt, at("2026-09-15T12:00:00.000Z"))).toEqual(
      at("2026-09-13T16:00:00.000Z"),
    );
    expect(assignmentAcknowledgementDeadline(assignedAt, at("2026-09-14T08:00:00.000Z"))).toEqual(
      at("2026-09-13T12:30:00.000Z"),
    );
  });

  it.each([
    ["paused", "workforce.account_paused"],
    ["terminated", "workforce.account_terminated"],
  ] as const)("hard-blocks a %s worker", (accountState, code) => {
    expect(evaluateAssignmentEligibility({ accountState, credentialsCurrent: true, overlaps: false, overtime: false, restWindow: false })).toMatchObject({ allowed: false, code });
  });

  it("hard-blocks expired credentials and overlapping work", () => {
    expect(evaluateAssignmentEligibility({ accountState: "active", credentialsCurrent: false, overlaps: false, overtime: false, restWindow: false })).toMatchObject({ allowed: false, code: "workforce.credentials_expired" });
    expect(evaluateAssignmentEligibility({ accountState: "active", credentialsCurrent: true, overlaps: true, overtime: false, restWindow: false })).toMatchObject({ allowed: false, code: "workforce.shift_overlap" });
  });

  it("returns overridable overtime and rest warnings", () => {
    expect(evaluateAssignmentEligibility({ accountState: "active", credentialsCurrent: true, overlaps: false, overtime: true, restWindow: true })).toEqual({
      allowed: true,
      code: "workforce.override_required",
      warnings: ["workforce.overtime_warning", "workforce.rest_window_warning"],
      overrideRequired: true,
    });
  });

  it("uses urgency-based coverage escalation and the fifteen-minute no-show rule", () => {
    const now = at("2026-09-13T12:00:00.000Z");
    expect(coverageEscalationDelayMs(now, at("2026-09-13T15:00:00.000Z"))).toBe(15 * 60_000);
    expect(coverageEscalationDelayMs(now, at("2026-09-14T08:00:00.000Z"))).toBe(60 * 60_000);
    expect(coverageEscalationDelayMs(now, at("2026-09-15T08:00:00.000Z"))).toBe(4 * 60 * 60_000);
    expect(evaluateNoShow(at("2026-09-13T13:16:00.000Z"), at("2026-09-13T13:00:00.000Z"), null)).toBe(true);
    expect(evaluateNoShow(at("2026-09-13T13:14:00.000Z"), at("2026-09-13T13:00:00.000Z"), null)).toBe(false);
  });

  it("schedules assignment, T-24h, T-1h, start, and no-show notices", () => {
    expect(workforceReminderSchedule(at("2026-09-15T12:00:00.000Z"), at("2026-09-13T12:00:00.000Z"))).toEqual([
      { kind: "assignment", at: at("2026-09-13T12:00:00.000Z") },
      { kind: "t24", at: at("2026-09-14T12:00:00.000Z") },
      { kind: "t1", at: at("2026-09-15T11:00:00.000Z") },
      { kind: "start", at: at("2026-09-15T12:00:00.000Z") },
      { kind: "no_show", at: at("2026-09-15T12:15:00.000Z") },
    ]);
  });
});
