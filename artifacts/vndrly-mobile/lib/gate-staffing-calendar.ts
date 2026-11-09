export type GateStaffingCalendarContext = {
  siteId: string;
  stationId: string;
  shiftId: string;
  date: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Calendar pointers never choose another gate or silently fall back to today. */
export function parseGateStaffingCalendarParams(params: Record<string, unknown>): GateStaffingCalendarContext | null {
  const { siteId, stationId, shiftId, date } = params;
  if (typeof siteId !== "string" || !/^[1-9]\d*$/.test(siteId) || !Number.isSafeInteger(Number(siteId)) ||
      typeof stationId !== "string" || !uuid.test(stationId) ||
      typeof shiftId !== "string" || !uuid.test(shiftId) ||
      typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  return { siteId, stationId, shiftId, date };
}

export function gateStaffingCalendarDay(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
