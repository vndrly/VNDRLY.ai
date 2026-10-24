export type ScheduleShift = { id: string; version: number; title: string; pattern: string; date: string; weekday: number; starts: string; ends: string; startsAt: string; endsAt: string; timezone: string; required: number; assignees: number[]; recurringAssignees?:number[]; assigneeNames?: Record<string,string> };
export type ScheduleData = { shifts: ScheduleShift[]; people: { id: number; name: string }[]; busy: { userId: number; shiftId: string; startsAt: string; endsAt: string }[]; readOnly: boolean };
export const shiftCell = (s: ScheduleShift) => `${s.pattern}|${s.starts}|${s.ends}|${s.weekday}`;
export const patternKey = (s: ScheduleShift) => `${s.pattern}|${s.starts}|${s.ends}`;
export function assignedWeekdayCells(shifts: ScheduleShift[], userId: number) {
  return new Set(shifts.filter(shift => (shift.recurringAssignees??shift.assignees).includes(userId)).map(shiftCell));
}
export function assignmentConflicts(selected: ScheduleShift[], userId: number, busy: ScheduleData["busy"]) {
  return selected.filter((shift, i) => busy.some(other => other.userId === userId && other.shiftId !== shift.id && other.startsAt < shift.endsAt && other.endsAt > shift.startsAt)
    || selected.some((other, j) => i !== j && other.startsAt < shift.endsAt && other.endsAt > shift.startsAt));
}
