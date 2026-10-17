import { z } from "zod/v4";
import {
  FleetWorkdayCommandSchema,
  FleetWorkdayEventSchema,
  FleetWorkdaySummarySchema,
  summarizeFleetWorkday,
  fleetWorkdayTimeInRange,
} from "./fleet-workday";

export const WorkdayOwnerSchema = z
  .object({
    type: z.enum(["vendor", "partner"]),
    id: z.number().int().positive(),
  })
  .strict();
export const WorkdayScopeSchema = z
  .object({
    owner: WorkdayOwnerSchema,
    userId: z.number().int().positive(),
    membershipId: z.number().int().positive(),
    sessionVersion: z.number().int().nonnegative(),
  })
  .strict();
/** Portal is intentionally absent: Gate, Field, Fleet, office and assistants
 * submit the same organization-scoped command, rather than separate clocks. */
export const WorkdayCommandSchema = FleetWorkdayCommandSchema.omit({
  scope: true,
})
  .extend({ scope: WorkdayScopeSchema })
  .strict();
export const WorkdayEventSchema = FleetWorkdayEventSchema.omit({
  companyId: true,
  driverUserId: true,
  source: true,
})
  .extend({
    owner: WorkdayOwnerSchema,
    workerUserId: z.number().int().positive(),
    source: z.literal("worker_report"),
  })
  .strict();
export const WorkdaySummarySchema = FleetWorkdaySummarySchema.omit({
  companyId: true,
  driverUserId: true,
  source: true,
})
  .extend({
    owner: WorkdayOwnerSchema,
    workerUserId: z.number().int().positive(),
    source: z.literal("worker_report"),
  })
  .strict();
export const WorkdaySnapshotSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    owner: WorkdayOwnerSchema,
    workerUserId: z.number().int().positive(),
    timezone: WorkdayCommandSchema.shape.timezone,
    summary: WorkdaySummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.id !== value.summary.shiftId ||
      value.workerUserId !== value.summary.workerUserId ||
      !sameWorkdayOwner(value.owner, value.summary.owner)
    )
      ctx.addIssue({
        code: "custom",
        message: "Workday identity must match its summary",
      });
  });
export const WorkdayReceiptSchema = z
  .object({
    operationId: z.uuid(),
    shiftId: z.uuid(),
    version: z.number().int().positive(),
    event: WorkdayEventSchema,
    summary: WorkdaySummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.operationId !== value.event.id ||
      value.shiftId !== value.event.shiftId ||
      value.shiftId !== value.summary.shiftId ||
      value.event.workerUserId !== value.summary.workerUserId ||
      !sameWorkdayOwner(value.event.owner, value.summary.owner)
    )
      ctx.addIssue({
        code: "custom",
        message: "Receipt must preserve its event and employer identities",
      });
  });
export type WorkdayOwner = z.infer<typeof WorkdayOwnerSchema>;
export type WorkdayScope = z.infer<typeof WorkdayScopeSchema>;
export type WorkdayCommand = z.infer<typeof WorkdayCommandSchema>;
export type WorkdayEvent = z.infer<typeof WorkdayEventSchema>;
export type WorkdaySummary = z.infer<typeof WorkdaySummarySchema>;
export type WorkdaySnapshot = z.infer<typeof WorkdaySnapshotSchema>;
export type WorkdayReceipt = z.infer<typeof WorkdayReceiptSchema>;
export function sameWorkdayOwner(a: WorkdayOwner, b: WorkdayOwner) {
  return a.type === b.type && a.id === b.id;
}

function mathEvents(raw: readonly WorkdayEvent[]) {
  const events = z.array(WorkdayEventSchema).min(1).parse(raw),
    first = events[0];
  if (events.some((event) => !sameWorkdayOwner(event.owner, first.owner)))
    throw new Error("workday.employer_conflict");
  return {
    first,
    events: events.map(
      ({ owner, workerUserId, source: _source, ...event }) => ({
        ...event,
        companyId: owner.id,
        driverUserId: workerUserId,
        source: "driver_report" as const,
      }),
    ),
  };
}
/** One calculation path retains the tested exact interval arithmetic. The
 * historical Fleet field names are an internal adapter, never employer identity. */
export function summarizeWorkday(raw: readonly WorkdayEvent[]): WorkdaySummary {
  const { first, events } = mathEvents(raw);
  const {
    companyId: _companyId,
    driverUserId,
    source: _source,
    ...summary
  } = summarizeFleetWorkday(events);
  return WorkdaySummarySchema.parse({
    ...summary,
    owner: first.owner,
    workerUserId: driverUserId,
    source: "worker_report",
  });
}
export function workdayTimeInRange(
  raw: readonly WorkdayEvent[],
  start: string,
  end: string,
) {
  return fleetWorkdayTimeInRange(mathEvents(raw).events, start, end);
}

/** Assistants may report only the consenting current worker, at actual server
 * execution time. Original-scope offline commands remain a separate capture. */
export const WorkdayAssistantInputSchema=z.object({operationId:z.uuid(),action:WorkdayCommandSchema.shape.action,expectedShiftId:z.uuid().nullable(),timezone:WorkdayCommandSchema.shape.timezone}).strict();
