/** Calendar days are local dates, not midnight UTC timestamps. */
export function calendarDayFromSearch(search: string): string | null {
  const day = new URLSearchParams(search).get("day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00`);
  return Number.isFinite(date.getTime()) && localCalendarDay(date) === day ? day : null;
}
export function localCalendarDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarWorkerFromSearch(search: string): { requested: boolean; userId: number | null } {
  const values = new URLSearchParams(search).getAll("worker");
  if (!values.length) return { requested: false, userId: null };
  const id = Number(values[0]);
  return { requested: true, userId: values.length === 1 && /^[1-9]\d*$/.test(values[0]) && Number.isSafeInteger(id) ? id : null };
}
export function recordedShiftCalendarHref(shift: { id: string; startedAt: string }, workerUserId?: number) {
  return `/work-hub/calendar?${new URLSearchParams({ day: localCalendarDay(new Date(shift.startedAt)), workday: shift.id, ...(workerUserId ? { worker: String(workerUserId) } : {}) })}`;
}
