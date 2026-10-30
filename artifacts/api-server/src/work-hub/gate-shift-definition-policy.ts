import { z } from "zod/v4";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const gateShiftDefinitionSchema = z.object({
  id: z.uuid().optional(), version: z.number().int().positive().optional(),
  stationIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  startsAtLocal: clock, endsAtLocal: clock,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
  timezone: z.string().min(1).max(100).refine(zone => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }),
  requiredCount: z.number().int().min(1).max(20).default(1), notes: z.string().max(20000).default(""),
  userIds: z.array(z.number().int().positive()).max(100).default([]), crewIds: z.array(z.uuid()).max(100).default([]),
}).refine(value => value.startsAtLocal !== value.endsAtLocal, "Choose different start and end times")
  .refine(value => !value.id || value.version && value.stationIds.length === 1, "Choose one existing gate definition to edit");
export type GateShiftDefinitionInput = z.infer<typeof gateShiftDefinitionSchema>;
export function gateClockLabel(clock: string) { const [h, m] = clock.split(":").map(Number); return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; }
export function localGateDay(now: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function nextGateDay(day: string, offset: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
/** Convert a gate's civil time, including the DST change, without assuming a fixed UTC offset. */
export function gateCivilTime(day: string, clock: string, timezone: string) {
  const desired = Date.parse(`${day}T${clock}:00Z`);
  let guess = desired;
  for (let i = 0; i < 5; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const rendered = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    if (rendered === desired) return new Date(guess);
    guess += desired - rendered;
  }
  throw new Error("That local gate time is unavailable because of a clock change.");
}
export function gateDefinitionWindows(definition: Pick<GateShiftDefinitionInput, "startsAtLocal" | "endsAtLocal" | "weekdays" | "timezone">, now: Date) {
  const day = localGateDay(now, definition.timezone);
  return Array.from({ length: 8 }, (_, index) => nextGateDay(day, index)).filter(date => definition.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())).map(date => ({
    startsAt: gateCivilTime(date, definition.startsAtLocal, definition.timezone),
    endsAt: gateCivilTime(nextGateDay(date, definition.endsAtLocal <= definition.startsAtLocal ? 1 : 0), definition.endsAtLocal, definition.timezone),
  })).filter(window => window.startsAt > now);
}
