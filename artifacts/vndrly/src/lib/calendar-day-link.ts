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
export function recordedShiftCalendarHref(shift: { id: string; startedAt: string }) {
  return `/work-hub/calendar?${new URLSearchParams({ day: localCalendarDay(new Date(shift.startedAt)), workday: shift.id })}`;
}
