import { z } from "zod/v4";

const positiveId = z.number().int().positive();
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "A recognized timezone is required");
export const FleetWorkdayScopeSchema = z
  .object({
    companyId: positiveId,
    userId: positiveId,
    membershipId: positiveId,
    sessionVersion: z.number().int().nonnegative(),
  })
  .strict();
export const FleetWorkdayActionSchema = z.enum([
  "start_shift",
  "start_unpaid_break",
  "end_unpaid_break",
  "end_shift",
]);
/** Original identity is carried by every intent, including an offline retry.
 * The server must compare this identity with its trusted session before writing. */
export const FleetWorkdayCommandSchema = z
  .object({
    operationId: z.uuid(),
    shiftId: z.uuid(),
    scope: FleetWorkdayScopeSchema,
    action: FleetWorkdayActionSchema,
    capturedAt: z.iso.datetime(),
    timezone,
  })
  .strict();
export const FleetWorkdayEventSchema = z
  .object({
    id: z.uuid(),
    shiftId: z.uuid(),
    companyId: positiveId,
    driverUserId: positiveId,
    kind: FleetWorkdayActionSchema,
    capturedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    source: z.literal("driver_report"),
  })
  .strict();
export type FleetWorkdayCommand = z.infer<typeof FleetWorkdayCommandSchema>;
export type FleetWorkdayEvent = z.infer<typeof FleetWorkdayEventSchema>;
export const FleetWorkdaySummarySchema = z
  .object({
    shiftId: z.uuid(),
    companyId: positiveId,
    driverUserId: positiveId,
    state: z.enum(["on_shift", "on_break", "ended"]),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    elapsedMilliseconds: z.number().int().nonnegative().nullable(),
    unpaidBreakMilliseconds: z.number().int().nonnegative(),
    reportedWorkMilliseconds: z.number().int().nonnegative().nullable(),
    payrollApproved: z.literal(false),
    source: z.literal("driver_report"),
    reviewFlags: z.array(
      z.enum(["clock_ahead_of_server", "missing_shift_end"]),
    ),
  })
  .strict();
export const FleetWorkdaySnapshotSchema = z
  .object({
    id: z.uuid(),
    version: positiveId,
    companyId: positiveId,
    driverUserId: positiveId,
    timezone,
    summary: FleetWorkdaySummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.id !== value.summary.shiftId ||
      value.companyId !== value.summary.companyId ||
      value.driverUserId !== value.summary.driverUserId
    )
      ctx.addIssue({
        code: "custom",
        message: "Workday identity must match its summary",
      });
  });
export const FleetWorkdayReceiptSchema = z
  .object({
    operationId: z.uuid(),
    shiftId: z.uuid(),
    version: positiveId,
    event: FleetWorkdayEventSchema,
    summary: FleetWorkdaySummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.operationId !== value.event.id ||
      value.shiftId !== value.event.shiftId ||
      value.shiftId !== value.summary.shiftId ||
      value.event.companyId !== value.summary.companyId ||
      value.event.driverUserId !== value.summary.driverUserId
    )
      ctx.addIssue({
        code: "custom",
        message: "Receipt must preserve its exact event and workday identities",
      });
  });
export type FleetWorkdaySummary = z.infer<typeof FleetWorkdaySummarySchema>;
export type FleetWorkdaySnapshot = z.infer<typeof FleetWorkdaySnapshotSchema>;
export type FleetWorkdayReceipt = z.infer<typeof FleetWorkdayReceiptSchema>;

/** Reported workday time only. No GPS/ELD proof, payroll approval, rounding,
 * overtime, minimum, or automatic meal deduction is inferred here. Events are
 * checked in accepted command order, never sorted to conceal clock conflicts. */
export function summarizeFleetWorkday(raw: readonly FleetWorkdayEvent[]) {
  const events = z.array(FleetWorkdayEventSchema).min(1).parse(raw);
  const first = events[0];
  const seen = new Set<string>();
  let state: "not_started" | "on_shift" | "on_break" | "ended" = "not_started";
  let startedAt: string | null = null,
    endedAt: string | null = null;
  let previous = -Infinity,
    breakStarted: number | null = null;
  let unpaidBreakMilliseconds = 0;
  const reviewFlags: ("clock_ahead_of_server" | "missing_shift_end")[] = [];
  for (const event of events) {
    if (
      event.companyId !== first.companyId ||
      event.driverUserId !== first.driverUserId ||
      event.shiftId !== first.shiftId ||
      seen.has(event.id)
    )
      throw new Error("fleet.workday_identity_conflict");
    seen.add(event.id);
    const captured = Date.parse(event.capturedAt);
    if (captured < previous) throw new Error("fleet.workday_clock_conflict");
    previous = captured;
    if (
      captured - Date.parse(event.receivedAt) > 300000 &&
      !reviewFlags.includes("clock_ahead_of_server")
    )
      reviewFlags.push("clock_ahead_of_server");
    if (event.kind === "start_shift" && state === "not_started") {
      startedAt = event.capturedAt;
      state = "on_shift";
    } else if (event.kind === "start_unpaid_break" && state === "on_shift") {
      breakStarted = captured;
      state = "on_break";
    } else if (event.kind === "end_unpaid_break" && state === "on_break") {
      unpaidBreakMilliseconds += captured - breakStarted!;
      breakStarted = null;
      state = "on_shift";
    } else if (
      event.kind === "end_shift" &&
      (state === "on_shift" || state === "on_break")
    ) {
      if (breakStarted !== null)
        unpaidBreakMilliseconds += captured - breakStarted;
      endedAt = event.capturedAt;
      state = "ended";
    } else throw new Error("fleet.workday_transition_conflict");
  }
  if (!endedAt) reviewFlags.push("missing_shift_end");
  const elapsedMilliseconds =
    startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null;
  return FleetWorkdaySummarySchema.parse({
    shiftId: first.shiftId,
    companyId: first.companyId,
    driverUserId: first.driverUserId,
    state,
    startedAt,
    endedAt,
    elapsedMilliseconds,
    unpaidBreakMilliseconds,
    reportedWorkMilliseconds:
      elapsedMilliseconds === null
        ? null
        : elapsedMilliseconds - unpaidBreakMilliseconds,
    payrollApproved: false as const,
    source: "driver_report" as const,
    reviewFlags,
  });
}

/** Clip reported working segments to explicit UTC bounds chosen for a calendar
 * day/timezone. An overnight shift is not charged in full to both days. */
export function fleetWorkdayTimeInRange(
  events: readonly FleetWorkdayEvent[],
  start: string,
  end: string,
): number | null {
  const from = Date.parse(z.iso.datetime().parse(start)),
    until = Date.parse(z.iso.datetime().parse(end));
  if (from >= until) throw new Error("fleet.workday_invalid_range");
  const summary = summarizeFleetWorkday(events);
  if (!summary.endedAt) return null;
  let workingFrom: number | null = null,
    total = 0;
  for (const event of events) {
    const at = Date.parse(event.capturedAt);
    if (event.kind === "start_shift" || event.kind === "end_unpaid_break")
      workingFrom = at;
    else if (
      workingFrom !== null &&
      (event.kind === "start_unpaid_break" || event.kind === "end_shift")
    ) {
      total += Math.max(0, Math.min(until, at) - Math.max(from, workingFrom));
      workingFrom = null;
    }
  }
  return total;
}
