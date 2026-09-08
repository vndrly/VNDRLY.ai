export type ShiftConflict = { code: "shift.employee_inactive" | "shift.qualification_missing" | "shift.overlap" | "shift.rest_window"; severity: "warning" | "blocking" };

export function evaluateShiftConflicts(input: {
  startsAt: string; endsAt: string; existing: { startsAt: string; endsAt: string }[];
  active: boolean; qualified: boolean; minimumRestMinutes?: number;
}): ShiftConflict[] {
  const start = new Date(input.startsAt).getTime(); const end = new Date(input.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("work_hub.invalid_shift_window");
  const result: ShiftConflict[] = [];
  if (!input.active) result.push({ code: "shift.employee_inactive", severity: "blocking" });
  if (!input.qualified) result.push({ code: "shift.qualification_missing", severity: "blocking" });
  if (input.existing.some((item) => start < new Date(item.endsAt).getTime() && end > new Date(item.startsAt).getTime())) result.push({ code: "shift.overlap", severity: "blocking" });
  const restMs = (input.minimumRestMinutes ?? 0) * 60_000;
  if (restMs > 0 && input.existing.some((item) => {
    const priorEnd = new Date(item.endsAt).getTime(); const nextStart = new Date(item.startsAt).getTime();
    return (priorEnd <= start && start - priorEnd < restMs) || (end <= nextStart && nextStart - end < restMs);
  })) result.push({ code: "shift.rest_window", severity: "warning" });
  return result;
}

export type RecurrenceRule = { frequency: "daily" | "weekly" | "monthly"; interval: number; weekdays?: number[]; timezone: string };
export function normalizeRecurrenceRule(value: RecurrenceRule): RecurrenceRule {
  if (!value || !["daily", "weekly", "monthly"].includes(value.frequency) || !Number.isInteger(value.interval) || value.interval < 1 || value.interval > 52 || typeof value.timezone !== "string" || !value.timezone.includes("/")) throw new Error("work_hub.invalid_recurrence");
  const weekdays = value.weekdays ? [...new Set(value.weekdays)].sort((a, b) => a - b) : undefined;
  if (weekdays?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("work_hub.invalid_recurrence");
  return { frequency: value.frequency, interval: value.interval, ...(weekdays?.length ? { weekdays } : {}), timezone: value.timezone };
}

type Consent = { userId: number; policyVersion: number; response: "accepted" | "declined" };
export function validateMeetingConsent(policyVersion: number, consents: Consent[], presentUserIds = consents.map((item) => item.userId)) {
  const current = new Map(consents.filter((item) => item.policyVersion === policyVersion).map((item) => [item.userId, item.response]));
  return {
    allowed: presentUserIds.every((id) => current.get(id) === "accepted"),
    missingUserIds: presentUserIds.filter((id) => !current.has(id)),
    declinedUserIds: presentUserIds.filter((id) => current.get(id) === "declined"),
  };
}
