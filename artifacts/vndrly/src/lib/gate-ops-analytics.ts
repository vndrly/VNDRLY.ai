import type { VisitorRow } from "./visits-api";
import { normalizePlateNumber, plateMatchKey } from "@workspace/plate-state";

export function dwellMinutes(visit: Pick<VisitorRow, "checkInTime" | "checkOutTime">, now: Date): number {
  const start = Date.parse(visit.checkInTime);
  const end = visit.checkOutTime ? Date.parse(visit.checkOutTime) : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function hourUtc(iso: string): number {
  return new Date(iso).getUTCHours();
}

export type GateOpsAnalytics = {
  onSiteNow: number;
  overdueNow: number;
  autoCheckedOut: number;
  uniquePlates: number;
  uniqueVisitors: number;
  avgDwellMinutes: number;
  topCompanies: { name: string; count: number }[];
  visitsByDay: { day: string; checkIns: number; stillOnSite: number }[];
  visitsByHour: { hour: number; count: number }[];
  visitsBySite: { siteName: string; count: number; avgDwellMinutes: number }[];
};

export function buildGateOpsAnalytics(visits: VisitorRow[], now: Date): GateOpsAnalytics {
  const onSite = visits.filter((v) => !v.checkOutTime && v.admissionStatus !== "pending");
  const completed = visits.filter((v) => v.checkOutTime && v.admissionStatus !== "pending");
  const overdueNow = onSite.filter((v) => {
    const expected = v.expectedDurationMinutes;
    if (!expected || expected <= 0) return false;
    return dwellMinutes(v, now) > expected;
  }).length;
  const completedDwell = completed.map((v) => dwellMinutes(v, now));
  const avgDwellMinutes =
    completedDwell.length === 0
      ? 0
      : Math.round(completedDwell.reduce((sum, n) => sum + n, 0) / completedDwell.length);

  const companies = new Map<string, number>();
  const plates = new Set<string>();
  const visitorKeys = new Set<string>();
  const byDay = new Map<string, { checkIns: number; stillOnSite: number }>();
  const byHour = new Map<number, number>();
  const bySite = new Map<string, { count: number; dwell: number }>();

  for (const visit of visits) {
    if (visit.company?.trim()) {
      const name = visit.company.trim();
      companies.set(name, (companies.get(name) ?? 0) + 1);
    }
    if (visit.vehiclePlate?.trim()) {
      const legacyPlate = normalizePlateNumber(visit.vehiclePlate)?.replace(/[^A-Z0-9]/g, "");
      const key = plateMatchKey(visit.plateState, visit.vehiclePlate)
        ?? (legacyPlate ? `legacy:${legacyPlate}` : null);
      if (key) plates.add(key);
    }
    visitorKeys.add(`${visit.firstName}|${visit.lastName}|${visit.company ?? ""}`.toLowerCase());
    const day = dayKey(visit.checkInTime);
    const dayRow = byDay.get(day) ?? { checkIns: 0, stillOnSite: 0 };
    dayRow.checkIns += 1;
    if (!visit.checkOutTime && visit.admissionStatus !== "pending") dayRow.stillOnSite += 1;
    byDay.set(day, dayRow);
    const hour = hourUtc(visit.checkInTime);
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    const siteName = visit.siteName || "Unknown site";
    const siteRow = bySite.get(siteName) ?? { count: 0, dwell: 0 };
    siteRow.count += 1;
    siteRow.dwell += dwellMinutes(visit, now);
    bySite.set(siteName, siteRow);
  }

  return {
    onSiteNow: onSite.length,
    overdueNow,
    autoCheckedOut: visits.filter((v) => v.autoCheckedOut).length,
    uniquePlates: plates.size,
    uniqueVisitors: visitorKeys.size,
    avgDwellMinutes,
    topCompanies: [...companies.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8),
    visitsByDay: [...byDay.entries()]
      .map(([day, row]) => ({ day, ...row }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    visitsByHour: [...byHour.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour),
    visitsBySite: [...bySite.entries()]
      .map(([siteName, row]) => ({
        siteName,
        count: row.count,
        avgDwellMinutes: Math.round(row.dwell / row.count),
      }))
      .sort((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName)),
  };
}

export type GateStaffMember = {
  employeeId: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  vendorName: string | null;
};

export type GateRecordedVisit = {
  recordedByUserId: number | null;
  checkInTime: string;
  checkOutTime: string | null;
};

export type GateEmployeeCheckIn = {
  employeeId: number;
  checkInAt: string;
  checkOutAt: string | null;
};

export type GateStaffHoursRow = {
  employeeId: number;
  userId: number | null;
  name: string;
  vendorName: string | null;
  daysWorked: number;
  visitsProcessed: number;
  hoursWorked: number;
  hoursClocked: number;
  hoursOnBooth: number;
  lastSeenAt: string | null;
};

function hoursBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3600000;
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildGateStaffHours(input: {
  staff: GateStaffMember[];
  visits: GateRecordedVisit[];
  checkIns: GateEmployeeCheckIn[];
  now: Date;
}): GateStaffHoursRow[] {
  return input.staff.map((person) => {
    const recorded = input.visits.filter(
      (visit) => person.userId != null && visit.recordedByUserId === person.userId,
    );
    const clocks = input.checkIns.filter((row) => row.employeeId === person.employeeId);
    const boothByDay = new Map<string, { start: string; end: string }>();
    for (const visit of recorded) {
      const day = dayKey(visit.checkInTime);
      const end = visit.checkOutTime ?? visit.checkInTime;
      const cur = boothByDay.get(day);
      if (!cur) {
        boothByDay.set(day, { start: visit.checkInTime, end });
        continue;
      }
      if (visit.checkInTime < cur.start) cur.start = visit.checkInTime;
      if (end > cur.end) cur.end = end;
    }
    let hoursOnBooth = 0;
    for (const span of boothByDay.values()) hoursOnBooth += hoursBetween(span.start, span.end);

    let hoursClocked = 0;
    const clockDays = new Set<string>();
    for (const row of clocks) {
      clockDays.add(dayKey(row.checkInAt));
      hoursClocked += hoursBetween(row.checkInAt, row.checkOutAt ?? input.now.toISOString());
    }

    const days = new Set<string>([...boothByDay.keys(), ...clockDays]);
    const lastSeenCandidates = [
      ...recorded.map((v) => v.checkOutTime ?? v.checkInTime),
      ...clocks.map((c) => c.checkOutAt ?? c.checkInAt),
    ].filter(Boolean) as string[];
    lastSeenCandidates.sort();
    const hoursClockedRounded = roundHours(hoursClocked);
    const hoursOnBoothRounded = roundHours(hoursOnBooth);
    return {
      employeeId: person.employeeId,
      userId: person.userId,
      name: `${person.firstName} ${person.lastName}`.trim(),
      vendorName: person.vendorName,
      daysWorked: days.size,
      visitsProcessed: recorded.length,
      hoursWorked: hoursClockedRounded,
      hoursClocked: hoursClockedRounded,
      hoursOnBooth: hoursOnBoothRounded,
      lastSeenAt: lastSeenCandidates.at(-1) ?? null,
    };
  });
}
