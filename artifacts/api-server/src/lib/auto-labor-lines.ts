import { and, eq, sql } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketCheckInsTable,
  vendorPeopleTable,
  ticketLineItemsTable,
  vendorsTable,
} from "@workspace/db";

const DEFAULT_DAILY_OT_HOURS = 8;
const DEFAULT_WEEKLY_OT_HOURS = 40;

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

function splitByUtcDay(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  if (end <= start) return [];
  const out: Array<{ start: Date; end: Date }> = [];
  let cur = start;
  while (cur < end) {
    const nextDay = new Date(Date.UTC(
      cur.getUTCFullYear(),
      cur.getUTCMonth(),
      cur.getUTCDate() + 1,
      0, 0, 0, 0,
    ));
    const sliceEnd = nextDay < end ? nextDay : end;
    out.push({ start: cur, end: sliceEnd });
    cur = sliceEnd;
  }
  return out;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Regenerate auto labor line items for a ticket.
 *
 * Replaces any rows whose description starts with "[auto]" while preserving
 * manually created labor lines. Uses the same OT bucketing rules as the
 * GET /tickets/:id/labor-summary endpoint so the totals match what's shown
 * on the crew time UI.
 *
 * Safe to call from check-out / submit handlers — returns the number of
 * rows inserted (0 if no closed sessions exist yet).
 */
export async function regenerateAutoLaborLines(ticketId: number): Promise<number> {
  // Resolve OT thresholds from vendor config (same precedence as labor-summary).
  const [ticketRow] = await db
    .select({ vendorId: ticketsTable.vendorId, closedAt: ticketsTable.closedAt })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));

  // Once the foreman / vendor-admin / org-admin closes the ticket the
  // running totals freeze. From this point on the [auto] lines are owned
  // by accounting (they may have edited them in place) so we MUST NOT
  // overwrite them on subsequent crew clock events.
  if (ticketRow?.closedAt) {
    return 0;
  }

  let vendorDailyOt: number | null = null;
  let vendorWeeklyOt: number | null = null;
  if (ticketRow?.vendorId) {
    const [v] = await db
      .select({ dailyOt: vendorsTable.dailyOtHours, weeklyOt: vendorsTable.weeklyOtHours })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, ticketRow.vendorId));
    if (v) {
      vendorDailyOt = v.dailyOt != null ? parseFloat(v.dailyOt) : null;
      vendorWeeklyOt = v.weeklyOt != null ? parseFloat(v.weeklyOt) : null;
    }
  }
  const dailyOt = vendorDailyOt || DEFAULT_DAILY_OT_HOURS;
  const weeklyOt = vendorWeeklyOt || DEFAULT_WEEKLY_OT_HOURS;

  const sessions = await db
    .select({
      employeeId: ticketCheckInsTable.employeeId,
      employeeName: sql<string>`${vendorPeopleTable.firstName} || ' ' || ${vendorPeopleTable.lastName}`,
      defaultRate: vendorPeopleTable.hourlyRate,
      // T005: rate_kind / daily_rate are read alongside the hourly rate so a
      // single sessions query supplies everything regenerate needs to decide
      // hourly-OT vs day-rate billing per employee. Day-rate employees get a
      // separate, simpler rollup below — they're billed per distinct UTC day
      // worked at `daily_rate`, with NO regular/OT split (a day rate is a
      // day rate regardless of hours). hourly_rate_at_time still wins on the
      // hourly path because it freezes the rate at clock-in time so a later
      // people-record edit doesn't retroactively rewrite labor history;
      // there is intentionally no `daily_rate_at_time` column today —
      // day-rate edits ARE retroactive until somebody asks otherwise.
      rateKind: vendorPeopleTable.rateKind,
      dailyRate: vendorPeopleTable.dailyRate,
      checkInAt: ticketCheckInsTable.checkInAt,
      checkOutAt: ticketCheckInsTable.checkOutAt,
      hourlyRateAtTime: ticketCheckInsTable.hourlyRateAtTime,
    })
    .from(ticketCheckInsTable)
    .leftJoin(vendorPeopleTable, eq(ticketCheckInsTable.employeeId, vendorPeopleTable.id))
    .where(eq(ticketCheckInsTable.ticketId, ticketId))
    .orderBy(ticketCheckInsTable.checkInAt);

  type HourlyBucket = { name: string; rate: number; regular: number; overtime: number };
  type DailyBucket = { name: string; rate: number; days: Set<string> };
  const hourlyGroups = new Map<string, HourlyBucket>();
  const dailyGroups = new Map<string, DailyBucket>();
  const dayBuckets = new Map<number, Map<string, number>>();
  const weekBuckets = new Map<number, Map<string, number>>();

  for (const s of sessions) {
    if (!s.checkOutAt) continue;
    const inAt = new Date(s.checkInAt);
    const outAt = new Date(s.checkOutAt);
    if (outAt <= inAt) continue;

    if (s.rateKind === "daily") {
      const dRate = parseFloat(s.dailyRate ?? "0");
      const key = `${s.employeeId}:${dRate.toFixed(2)}`;
      let g = dailyGroups.get(key);
      if (!g) {
        g = { name: s.employeeName, rate: dRate, days: new Set() };
        dailyGroups.set(key, g);
      }
      // Each calendar day touched by the session counts once. Even a
      // five-minute clock-in still owes a full day's pay under day-rate
      // billing — that's the whole point of the rate model.
      for (const chunk of splitByUtcDay(inAt, outAt)) {
        g.days.add(dayKey(chunk.start));
      }
      continue;
    }

    const rate = parseFloat(s.hourlyRateAtTime ?? s.defaultRate ?? "0");
    const sessionHours = hoursBetween(inAt, outAt);
    if (sessionHours <= 0) continue;

    let dayB = dayBuckets.get(s.employeeId);
    if (!dayB) { dayB = new Map(); dayBuckets.set(s.employeeId, dayB); }
    let weekB = weekBuckets.get(s.employeeId);
    if (!weekB) { weekB = new Map(); weekBuckets.set(s.employeeId, weekB); }

    let sessionOt = 0;
    for (const chunk of splitByUtcDay(inAt, outAt)) {
      const cHours = hoursBetween(chunk.start, chunk.end);
      if (cHours <= 0) continue;
      const dKey = dayKey(chunk.start);
      const wKey = isoWeekKey(chunk.start);
      const priorDay = dayB.get(dKey) ?? 0;
      const priorWeek = weekB.get(wKey) ?? 0;
      const dailyOver = Math.max(0, priorDay + cHours - dailyOt) - Math.max(0, priorDay - dailyOt);
      const weeklyOver = Math.max(0, priorWeek + cHours - weeklyOt) - Math.max(0, priorWeek - weeklyOt);
      sessionOt += Math.min(cHours, Math.max(dailyOver, weeklyOver));
      dayB.set(dKey, priorDay + cHours);
      weekB.set(wKey, priorWeek + cHours);
    }

    const otHours = Math.min(sessionHours, sessionOt);
    const regHours = sessionHours - otHours;
    const key = `${s.employeeId}:${rate.toFixed(2)}`;
    const existing = hourlyGroups.get(key);
    if (existing) {
      existing.regular += regHours;
      existing.overtime += otHours;
    } else {
      hourlyGroups.set(key, { name: s.employeeName, rate, regular: regHours, overtime: otHours });
    }
  }

  await db.delete(ticketLineItemsTable).where(and(
    eq(ticketLineItemsTable.ticketId, ticketId),
    eq(ticketLineItemsTable.type, "labor"),
    sql`${ticketLineItemsTable.description} LIKE '[auto]%'`,
  ));

  const rows: Array<{ ticketId: number; type: string; description: string; quantity: string; unitPrice: string }> = [];
  for (const p of hourlyGroups.values()) {
    const rateLabel = p.rate ? ` @ $${p.rate.toFixed(2)}/hr` : "";
    if (p.regular > 0) {
      rows.push({
        ticketId,
        type: "labor",
        description: `[auto] Labor — ${p.name}${rateLabel}`,
        quantity: String(Math.round(p.regular * 100) / 100),
        unitPrice: String(Math.round(p.rate * 100) / 100),
      });
    }
    if (p.overtime > 0) {
      const otRate = p.rate * 1.5;
      rows.push({
        ticketId,
        type: "labor",
        description: `[auto] Labor OT — ${p.name}${p.rate ? ` @ $${otRate.toFixed(2)}/hr (1.5x)` : ""}`,
        quantity: String(Math.round(p.overtime * 100) / 100),
        unitPrice: String(Math.round(otRate * 100) / 100),
      });
    }
  }
  // T005: day-rate rollup. One row per (employee, daily_rate) — the quantity
  // is the count of distinct UTC days the employee was clocked in on this
  // ticket, the unit price is the day rate. No OT line is emitted; if a
  // vendor needs different weekday vs weekend day rates they should split
  // the employee into two people records or move them to hourly.
  for (const p of dailyGroups.values()) {
    const days = p.days.size;
    if (days <= 0) continue;
    const rateLabel = p.rate ? ` @ $${p.rate.toFixed(2)}/day` : "";
    rows.push({
      ticketId,
      type: "labor",
      description: `[auto] Labor — ${p.name}${rateLabel}`,
      quantity: String(days),
      unitPrice: String(Math.round(p.rate * 100) / 100),
    });
  }
  if (rows.length > 0) {
    await db.insert(ticketLineItemsTable).values(rows);
  }
  return rows.length;
}
