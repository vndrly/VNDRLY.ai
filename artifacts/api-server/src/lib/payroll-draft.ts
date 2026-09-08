import { createHash } from "node:crypto";
import { z } from "zod";
import { toCsv } from "./reports/csv";

const money = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/);
export const payrollDraftInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1).max(100),
  weekStartsOn: z.number().int().min(0).max(6),
  dailyOvertimeHours: z.number().int().min(1).max(24).nullable(),
  weeklyOvertimeHours: z.number().int().min(1).max(168),
  overtimeMultiplier: z.string().regex(/^[1-9](\.\d{1,2})?$/),
  rates: z.array(z.object({ employeeId: z.number().int().positive(), hourlyWage: money })).max(1000),
  confirmed: z.literal(true),
});
export type PayrollDraftInput = z.infer<typeof payrollDraftInput>;
export type PayrollSession = { id: number; ticketId: number; employeeId: number; employeeName: string; checkInAt: string; checkOutAt: string | null };

function localDate(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  return ["year", "month", "day"].map((key) => parts.find((p) => p.type === key)!.value).join("-");
}
export function calendarAdd(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function midnight(date: string, zone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date");
  let value = target;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 5; i++) {
    const parts = formatter.formatToParts(value);
    const part = (key: string) => parts.find((p) => p.type === key)!.value;
    const rendered = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
    if (rendered === target) return value;
    value += target - rendered;
  }
  throw new Error("This timezone has an unsupported midnight transition for the selected date");
}
function weekKey(date: string, starts: number): string {
  return calendarAdd(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() - starts + 7) % 7));
}
export function payrollBounds(input: PayrollDraftInput) {
  const start = midnight(input.from, input.timeZone);
  const end = midnight(input.to, input.timeZone);
  if (end <= start || end - start > 93 * 86400000) throw new Error("Choose a period of 1 to 92 days; end date is exclusive");
  return { start, end, contextStart: midnight(weekKey(input.from, input.weekStartsOn), input.timeZone) };
}
function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function amount(value: bigint): string { return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`; }

export function buildPayrollDraft(raw: PayrollDraftInput, supplied: PayrollSession[]) {
  const input = payrollDraftInput.parse(raw);
  const { start, end, contextStart } = payrollBounds(input);
  const issues: string[] = [];
  const rates = new Map<number, bigint>();
  for (const rate of input.rates) {
    if (rates.has(rate.employeeId)) issues.push(`Duplicate wage for employee ${rate.employeeId}`);
    rates.set(rate.employeeId, cents(rate.hourlyWage));
  }
  const sessions = [...supplied].sort((a, b) => Date.parse(a.checkInAt) - Date.parse(b.checkInAt) || a.id - b.id);
  const seen = new Set<number>();
  const priorEnd = new Map<number, number>();
  const days = new Map<string, number>();
  const weeks = new Map<string, number>();
  const rows: Array<{ sessionId: number; ticketId: number; employeeId: number; employeeName: string; start: string; end: string; regularHours: string; overtimeHours: string; hourlyWage: string; grossPay: string }> = [];
  let totalCents = 0n;
  for (const session of sessions) {
    if (seen.has(session.id)) { issues.push(`Duplicate session ${session.id}`); continue; }
    seen.add(session.id);
    const originalStart = Date.parse(session.checkInAt);
    const originalEnd = session.checkOutAt ? Date.parse(session.checkOutAt) : NaN;
    if (!session.checkOutAt) { issues.push(`Session ${session.id} is still open`); continue; }
    if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd) || originalEnd <= originalStart) { issues.push(`Session ${session.id} has invalid times`); continue; }
    if (originalStart < (priorEnd.get(session.employeeId) ?? -Infinity)) issues.push(`Employee ${session.employeeId} has overlapping time at session ${session.id}`);
    priorEnd.set(session.employeeId, Math.max(originalEnd, priorEnd.get(session.employeeId) ?? -Infinity));
    const rate = rates.get(session.employeeId);
    if (rate === undefined) issues.push(`Missing confirmed wage for employee ${session.employeeId}`);
    let cursor = Math.max(originalStart, contextStart);
    const stop = Math.min(originalEnd, end);
    while (cursor < stop) {
      const date = localDate(cursor, input.timeZone);
      let next = Math.min(stop, midnight(calendarAdd(date, 1), input.timeZone));
      if (cursor < start && next > start) next = start;
      const day = `${session.employeeId}:${date}`;
      const week = `${session.employeeId}:${weekKey(date, input.weekStartsOn)}`;
      const duration = next - cursor;
      const dayUsed = days.get(day) ?? 0;
      const weekRegular = weeks.get(week) ?? 0;
      const dailyLimit = input.dailyOvertimeHours === null ? Infinity : input.dailyOvertimeHours * 3600000;
      const regular = Math.max(0, Math.min(duration, dailyLimit - dayUsed, input.weeklyOvertimeHours * 3600000 - weekRegular));
      const overtime = duration - regular;
      days.set(day, dayUsed + duration);
      weeks.set(week, weekRegular + regular);
      if (cursor >= start && rate !== undefined) {
        const numerator = rate * (BigInt(regular) * 100n + BigInt(overtime) * cents(input.overtimeMultiplier));
        const gross = (numerator + 180000000n) / 360000000n;
        totalCents += gross;
        rows.push({ sessionId: session.id, ticketId: session.ticketId, employeeId: session.employeeId, employeeName: session.employeeName, start: new Date(cursor).toISOString(), end: new Date(next).toISOString(), regularHours: (regular / 3600000).toFixed(4), overtimeHours: (overtime / 3600000).toFixed(4), hourlyWage: amount(rate), grossPay: amount(gross) });
      }
      cursor = next;
    }
  }
  if (!rows.length) issues.push("No payable closed sessions in this period");
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, input, sessions, rows, issues })).digest("hex");
  return { rows, issues: [...new Set(issues)], grossPay: amount(totalCents), fingerprint, exportable: issues.length === 0 };
}
export function payrollCsv(input: PayrollDraftInput, draft: ReturnType<typeof buildPayrollDraft>): string {
  if (!draft.exportable) throw new Error("Resolve all review issues before export");
  const safeText = (value: string) => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return toCsv(["Employee ID", "Employee", "Session ID", "Ticket ID", "Start UTC", "End UTC", "Regular hours", "Overtime hours", "Confirmed hourly wage USD", "Gross estimate USD", "Timezone", "Week starts (0=Sunday)", "Daily OT hours", "Weekly OT hours", "OT multiplier", "Review fingerprint"], draft.rows.map((r) => [r.employeeId, safeText(r.employeeName), r.sessionId, r.ticketId, r.start, r.end, r.regularHours, r.overtimeHours, r.hourlyWage, r.grossPay, safeText(input.timeZone), input.weekStartsOn, input.dailyOvertimeHours, input.weeklyOvertimeHours, input.overtimeMultiplier, draft.fingerprint]));
}
