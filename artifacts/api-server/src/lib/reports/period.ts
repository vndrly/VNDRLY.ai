// Period parsing for report endpoints. Accepts either an explicit
// (periodStart, periodEnd) pair or a `preset` shortcut (month, quarter,
// year, ytd, last_month, last_quarter, last_year). Returns half-open
// [start, end) interval in UTC; callers should treat `end` as exclusive.

import { z } from "zod/v4";

export const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "ytd",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface Period {
  start: Date;
  end: Date;
  /** Display label for headers — e.g. "Jan 2026", "Q1 2026", "2026", "Custom". */
  label: string;
}

export const periodQuerySchema = z.object({
  periodStart: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  periodEnd: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  preset: z.enum(PERIOD_PRESETS).optional(),
});
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

function utcMonthStart(y: number, m: number): Date {
  return new Date(Date.UTC(y, m, 1));
}
function utcYearStart(y: number): Date {
  return new Date(Date.UTC(y, 0, 1));
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function quarterOf(month: number): number {
  return Math.floor(month / 3); // 0..3
}

/** True if the input string is a date-only "YYYY-MM-DD" with no time part. */
function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function resolvePeriod(q: PeriodQuery, now: Date = new Date()): Period {
  if (q.periodStart && q.periodEnd) {
    const start = new Date(q.periodStart);
    let end = new Date(q.periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Invalid period date");
    }
    // Date-only inputs (e.g. "2026-04-30") are interpreted as inclusive of
    // that whole day. Bump end to the next day's midnight UTC so the
    // half-open [start, end) filter still includes the chosen end date.
    // Datetime inputs (with time / offset) are taken at face value.
    if (isDateOnly(q.periodEnd)) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    if (end <= start) {
      throw new Error("periodEnd must be after periodStart");
    }
    return { start, end, label: "Custom" };
  }
  const preset: PeriodPreset = q.preset ?? "ytd";
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (preset) {
    case "this_month":
      return {
        start: utcMonthStart(y, m),
        end: utcMonthStart(y, m + 1),
        label: `${MONTH_LABELS[m]} ${y}`,
      };
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return {
        start: utcMonthStart(ly, lm),
        end: utcMonthStart(ly, lm + 1),
        label: `${MONTH_LABELS[lm]} ${ly}`,
      };
    }
    case "this_quarter": {
      const qStartMonth = quarterOf(m) * 3;
      return {
        start: utcMonthStart(y, qStartMonth),
        end: utcMonthStart(y, qStartMonth + 3),
        label: `Q${quarterOf(m) + 1} ${y}`,
      };
    }
    case "last_quarter": {
      const qIdx = quarterOf(m);
      const lqIdx = qIdx === 0 ? 3 : qIdx - 1;
      const lqYear = qIdx === 0 ? y - 1 : y;
      return {
        start: utcMonthStart(lqYear, lqIdx * 3),
        end: utcMonthStart(lqYear, lqIdx * 3 + 3),
        label: `Q${lqIdx + 1} ${lqYear}`,
      };
    }
    case "this_year":
      return {
        start: utcYearStart(y),
        end: utcYearStart(y + 1),
        label: `${y}`,
      };
    case "last_year":
      return {
        start: utcYearStart(y - 1),
        end: utcYearStart(y),
        label: `${y - 1}`,
      };
    case "ytd":
    default:
      // Year-to-date: Jan 1 of current year through "now" (exclusive).
      // We bump `now` to the next millisecond so an end timestamp equal to
      // `now` is included in the half-open [start, end) interval. Using the
      // full calendar year here would incorrectly include future invoices.
      return {
        start: utcYearStart(y),
        end: new Date(now.getTime() + 1),
        label: `${y} YTD`,
      };
  }
}

export function formatPeriod(p: Period): string {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  // end is exclusive — display the inclusive last day for human-friendly UI.
  const inclusiveEnd = new Date(p.end.getTime() - 1);
  return `${fmt(p.start)} – ${fmt(inclusiveEnd)}`;
}
