import { z } from "zod/v4";
import { fleetInstantToWallTime, fleetWallTimeToInstant } from "./fleet-time";

export const GATE_BILLING_TIME_ZONE = "America/Chicago" as const;
export const GateBillingCoverageSchema = z
  .object({
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.endedAt === null ||
      Date.parse(value.endedAt) >= Date.parse(value.startedAt),
    "Coverage ends before it starts",
  );
export const GateBillingPeriodInputSchema = z
  .object({
    startDay: z.iso.date(),
    now: z.iso.datetime({ offset: true }),
    dailyRateCents: z.number().int().min(0).max(100000000),
    partialDayRule: z
      .enum(["full_day", "prorate_actual_day"])
      .default("full_day"),
    coverage: z.array(GateBillingCoverageSchema).max(10000),
  })
  .strict();
export type GateBillingPeriodInput = z.input<
  typeof GateBillingPeriodInputSchema
>;
export type GateBillingDay = {
  day: string;
  startsAt: string;
  endsAt: string;
  dayMilliseconds: number;
  staffedMilliseconds: number;
  hasCoverageGap: boolean;
  chargeCents: number;
};
function shiftDay(day: string, delta: number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
function midnight(day: string) {
  const value = fleetWallTimeToInstant(`${day}T00:00`, GATE_BILLING_TIME_ZONE);
  if (value.status !== "resolved") throw Error("gate_billing.invalid_midnight");
  return value.instant;
}
/** Completed calendar days, never elapsed 24-hour buckets or employee hours.
 * Coverage is a union of recorded post intervals: two workers do not double
 * the post rate. This calculator does not grant billing or approve an invoice. */
export function calculateGateBillingPeriod(raw: GateBillingPeriodInput) {
  const input = GateBillingPeriodInputSchema.parse(raw),
    today = fleetInstantToWallTime(input.now, GATE_BILLING_TIME_ZONE)!.slice(
      0,
      10,
    );
  if (input.startDay > today) throw Error("gate_billing.future_period");
  const count =
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(`${input.startDay}T00:00:00Z`)) /
    86400000;
  if (count > 3660) throw Error("gate_billing.period_too_long");
  const cutoffExclusive = midnight(today),
    cutoff = Date.parse(cutoffExclusive),
    intervals = input.coverage
      .map((value) => ({
        start: Date.parse(value.startedAt),
        end:
          value.endedAt === null
            ? cutoff
            : Math.min(cutoff, Date.parse(value.endedAt)),
      }))
      .filter((value) => value.start < value.end)
      .sort((a, b) => a.start - b.start),
    days: GateBillingDay[] = [];
  for (let day = input.startDay; day < today; day = shiftDay(day, 1)) {
    const startsAt = midnight(day),
      endsAt = midnight(shiftDay(day, 1)),
      start = Date.parse(startsAt),
      end = Date.parse(endsAt);
    let cursor = start,
      staffedMilliseconds = 0;
    for (const interval of intervals) {
      if (interval.start >= end) break;
      const from = Math.max(cursor, start, interval.start),
        to = Math.min(end, interval.end);
      if (to > from) {
        staffedMilliseconds += to - from;
        cursor = to;
      }
    }
    const dayMilliseconds = end - start,
      chargeCents =
        staffedMilliseconds === 0
          ? 0
          : input.partialDayRule === "full_day"
            ? input.dailyRateCents
            : Number(
                (BigInt(input.dailyRateCents) *
                  BigInt(staffedMilliseconds) *
                  2n +
                  BigInt(dayMilliseconds)) /
                  (BigInt(dayMilliseconds) * 2n),
              );
    days.push({
      day,
      startsAt,
      endsAt,
      dayMilliseconds,
      staffedMilliseconds,
      hasCoverageGap: staffedMilliseconds < dayMilliseconds,
      chargeCents,
    });
  }
  return {
    timeZone: GATE_BILLING_TIME_ZONE,
    periodStartDay: input.startDay,
    throughDay: shiftDay(today, -1),
    cutoffExclusive,
    nextPeriodStartDay: today,
    partialDayRule: input.partialDayRule,
    billableDays: days.filter((value) => value.staffedMilliseconds > 0).length,
    totalCents: days.reduce((total, value) => total + value.chargeCents, 0),
    days,
  };
}

export const GateBillingPeriodSchema = z
  .object({
    timeZone: z.literal("America/Chicago"),
    periodStartDay: z.iso.date(),
    throughDay: z.iso.date(),
    cutoffExclusive: z.iso.datetime(),
    nextPeriodStartDay: z.iso.date(),
    partialDayRule: z.enum(["full_day", "prorate_actual_day"]),
    billableDays: z.number().int().nonnegative(),
    totalCents: z.number().int().nonnegative(),
    days: z
      .array(
        z
          .object({
            day: z.iso.date(),
            startsAt: z.iso.datetime(),
            endsAt: z.iso.datetime(),
            dayMilliseconds: z.number().int().positive(),
            staffedMilliseconds: z.number().int().nonnegative(),
            hasCoverageGap: z.boolean(),
            chargeCents: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(3660),
  })
  .strict();
