import type { ScheduleShift } from "./shift-assignment-model";
export const coverageCategories = [
  "New / Unassigned Recurring Shifts",
  "Temporary coverage",
  "Permanent vacancies",
  "Coverage requests",
  "Urgent gaps",
] as const;
export type CoverageCategory = (typeof coverageCategories)[number];
export type CoverageGap = {
  id: string;
  category: CoverageCategory;
  siteId: number;
  siteName: string;
  shift: ScheduleShift | null;
  title: string;
  detail: string;
  originalUserId?: number;
  requestId?: string;
  required: number;
};
export type CoverageFacts = {
  unavailable: { userId: number; startsAt: string; endsAt: string }[];
  workers: { userId: number; state: "active" | "hold" | "inactive" }[];
  requests: { id: string; shiftId: string; userId: number }[];
  urgentShiftIds: string[];
  readOnly: boolean;
};
export function classifyCoverage(
  siteId: number,
  siteName: string,
  shifts: ScheduleShift[],
  facts: CoverageFacts,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const shift of shifts) {
    const base = { siteId, siteName, shift, title: shift.pattern, required: 1 };
    const requests = facts.requests.filter(
      (r) => r.shiftId === shift.id && shift.assignees.includes(r.userId),
    );
    const unavailable = shift.assignees.filter(
      (id) =>
        facts.workers.some((w) => w.userId === id && w.state !== "active") ||
        facts.unavailable.some(
          (w) =>
            w.userId === id &&
            w.startsAt < shift.endsAt &&
            w.endsAt > shift.startsAt,
        ),
    );
    const affected = new Set<number>();
    for (const userId of unavailable) {
      affected.add(userId);
      const inactive = facts.workers.some(
        (w) => w.userId === userId && w.state === "inactive",
      );
      gaps.push({
        ...base,
        id: `worker:${shift.id}:${userId}`,
        category: inactive ? "Permanent vacancies" : "Temporary coverage",
        originalUserId: userId,
        requestId: requests.find((r) => r.userId === userId)?.id,
        detail: inactive
          ? "Assigned worker is no longer active; review permanent coverage."
          : "Assigned worker is on hold or has recorded unavailability.",
      });
    }
    for (const r of requests)
      if (!affected.has(r.userId)) {
        affected.add(r.userId);
        gaps.push({
          ...base,
          id: `request:${r.id}`,
          category: "Coverage requests",
          originalUserId: r.userId,
          requestId: r.id,
          detail: "Gatekeeper requested coverage for this dated shift.",
        });
      }
    const needed = Math.max(0, shift.required - shift.assignees.length);
    if (needed)
      gaps.push({
        ...base,
        id: `vacancy:${shift.id}`,
        category: facts.urgentShiftIds.includes(shift.id)
          ? "Urgent gaps"
          : "New / Unassigned Recurring Shifts",
        required: needed,
        detail: `${needed} unassigned position(s).`,
      });
    else if (facts.urgentShiftIds.includes(shift.id) && !affected.size)
      for (const userId of shift.assignees)
        gaps.push({
          ...base,
          id: `urgent:${shift.id}:${userId}`,
          category: "Urgent gaps",
          originalUserId: userId,
          detail: `Recorded coverage alert. Review ${shift.assigneeNames?.[String(userId)] ?? "the assigned gatekeeper"}'s responsibility before replacing them.`,
        });
  }
  return gaps;
}
