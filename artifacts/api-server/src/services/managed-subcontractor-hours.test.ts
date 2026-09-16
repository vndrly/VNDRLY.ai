import { describe, expect, it } from "vitest";
import {
  approvalSatisfied,
  buildManagedSubcontractorHoursReport,
} from "./managed-subcontractor-hours";

describe("managed subcontractor hours", () => {
  it.each([
    ["contractor", true, false, true],
    ["contractor", false, true, false],
    ["subcontractor", false, true, true],
    ["either", true, false, true],
    ["either", false, true, true],
    ["dual", true, false, false],
    ["dual", true, true, true],
  ] as const)("applies %s approval policy", (policy, contractor, subcontractor, expected) => {
    expect(approvalSatisfied(policy, { contractor, subcontractor })).toBe(expected);
  });

  it("uses completed field work for accrued hours and keeps scheduled hours visible", () => {
    const report = buildManagedSubcontractorHoursReport({
      organization: { id: "newtech", name: "NewTech" },
      sponsor: { id: 7, name: "Midcon" },
      approvalPolicy: "either",
      approvals: { contractor: true, subcontractor: false },
      range: { start: "2026-09-14T00:00:00.000Z", end: "2026-09-21T00:00:00.000Z" },
      shifts: [{ id: "shift-1", userId: 22, workerName: "Alex Gate", siteName: "North Gate", startsAt: "2026-09-15T12:00:00.000Z", endsAt: "2026-09-15T20:00:00.000Z" }],
      trips: [{ shiftId: "shift-1", userId: 22, startedAt: "2026-09-15T12:10:00.000Z", completedAt: "2026-09-15T19:55:00.000Z" }],
    });
    expect(report.lines[0]).toMatchObject({ scheduledMinutes: 480, actualMinutes: 465, approvedMinutes: 465, source: "field_work" });
    expect(report.totals).toEqual({ scheduledMinutes: 480, actualMinutes: 465, approvedMinutes: 465 });
  });

  it("flags missing work data and lets an audited correction replace it", () => {
    const base = {
      organization: { id: "newtech", name: "NewTech" },
      sponsor: { id: 7, name: "Midcon" },
      approvalPolicy: "dual" as const,
      approvals: { contractor: true, subcontractor: true },
      range: { start: "2026-09-14T00:00:00.000Z", end: "2026-09-21T00:00:00.000Z" },
      shifts: [{ id: "shift-2", userId: 23, workerName: "Jamie Gate", siteName: "South Gate", startsAt: "2026-09-16T12:00:00.000Z", endsAt: "2026-09-16T20:00:00.000Z" }],
      trips: [],
    };
    expect(buildManagedSubcontractorHoursReport(base).lines[0].exceptions).toContain("missing_actual");
    const corrected = buildManagedSubcontractorHoursReport({
      ...base,
      corrections: [{ shiftId: "shift-2", userId: 23, actualStart: "2026-09-16T12:05:00.000Z", actualEnd: "2026-09-16T20:00:00.000Z", reason: "Supervisor verified paper gate log", correctedByUserId: 9, correctedAt: "2026-09-16T21:00:00.000Z" }],
    });
    expect(corrected.lines[0]).toMatchObject({ actualMinutes: 475, approvedMinutes: 475, source: "correction", exceptions: [] });
  });
});
