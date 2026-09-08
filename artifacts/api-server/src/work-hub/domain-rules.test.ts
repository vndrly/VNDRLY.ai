import { describe, expect, it } from "vitest";
import { evaluateShiftConflicts, normalizeRecurrenceRule, validateMeetingConsent } from "./domain-rules";

describe("Work Hub domain rules", () => {
  it("returns stable blocking and warning shift conflict codes", () => {
    expect(evaluateShiftConflicts({
      startsAt: "2026-09-08T14:00:00.000Z", endsAt: "2026-09-08T22:00:00.000Z",
      existing: [{ startsAt: "2026-09-08T20:00:00.000Z", endsAt: "2026-09-09T01:00:00.000Z" }],
      active: false, qualified: false,
    })).toEqual([
      { code: "shift.employee_inactive", severity: "blocking" },
      { code: "shift.qualification_missing", severity: "blocking" },
      { code: "shift.overlap", severity: "blocking" },
    ]);
  });

  it("normalizes constrained recurring rules without accepting cron text", () => {
    expect(normalizeRecurrenceRule({ frequency: "weekly", interval: 2, weekdays: [5, 1, 5], timezone: "America/Chicago" }))
      .toEqual({ frequency: "weekly", interval: 2, weekdays: [1, 5], timezone: "America/Chicago" });
    expect(() => normalizeRecurrenceRule({ cron: "* * * * *" } as never)).toThrow("work_hub.invalid_recurrence");
  });

  it("blocks capture until every present participant accepts the policy version", () => {
    expect(validateMeetingConsent(3, [{ userId: 1, policyVersion: 3, response: "accepted" }, { userId: 2, policyVersion: 3, response: "declined" }])).toEqual({ allowed: false, missingUserIds: [], declinedUserIds: [2] });
    expect(validateMeetingConsent(3, [{ userId: 1, policyVersion: 3, response: "accepted" }], [1, 2])).toEqual({ allowed: false, missingUserIds: [2], declinedUserIds: [] });
  });
});
