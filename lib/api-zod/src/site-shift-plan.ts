import { z } from "zod/v4";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time");
export const siteShiftRowSchema = z.object({
  patternName: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Use a valid timezone").optional(),
  startsAtLocal: clock,
  endsAtLocal: clock,
  requiredCount: z.number().int().min(1).max(500),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});
export type SiteShiftRow = z.infer<typeof siteShiftRowSchema>;
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function shiftMinutes(row: Pick<SiteShiftRow, "startsAtLocal" | "endsAtLocal">) {
  return (minutes(row.endsAtLocal) - minutes(row.startsAtLocal) + 1440) % 1440 || 1440;
}
// A coverage day starts at the first shift, allowing a 06:00–06:00 staffing cycle.
export function hasFullDayCoverage(rows: SiteShiftRow[], weekday: number) {
  const shifts = rows.filter(row => row.weekdays.includes(weekday));
  if (!shifts.length) return false;
  const anchor = minutes(shifts[0].startsAtLocal);
  const intervals = shifts.map(row => {
    const start = (minutes(row.startsAtLocal) - anchor + 1440) % 1440;
    return { start, end: start + shiftMinutes(row) };
  }).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const interval of intervals) {
    if (interval.start !== cursor) return false;
    cursor = interval.end;
  }
  return cursor === 1440;
}
export const siteShiftPlanSchema = z.object({
  mode: z.enum(["part_time", "24_hour"]),
  shifts: z.array(siteShiftRowSchema).min(1).max(24),
}).superRefine((plan, ctx) => {
  if (plan.mode === "24_hour") {
    const days = [...new Set(plan.shifts.flatMap(row => row.weekdays))];
    if (days.some(day => !hasFullDayCoverage(plan.shifts, day)))
      ctx.addIssue({ code: "custom", message: "Each selected day needs exactly 24 hours of coverage, without gaps or overlaps.", path: ["shifts"] });
  }
});
export type SiteShiftPlan = z.infer<typeof siteShiftPlanSchema>;
