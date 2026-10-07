import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";

const utc = z.iso.datetime();
export { WorkHubCalendarSnapshotSchema as calendarSnapshotSchema } from "@workspace/api-zod";
import { WorkHubCalendarSnapshotSchema as calendarSnapshotSchema } from "@workspace/api-zod";
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export function calendarSnapshotFingerprint(raw: unknown) {
  const snapshot = calendarSnapshotSchema.parse(raw);
  return createHash("sha256").update(JSON.stringify({ ...snapshot, participantUserIds: [...new Set(snapshot.participantUserIds)].sort((a,b)=>a-b) })).digest("hex");
}
export const calendarRescheduleInputSchema = z.object({
  operationId: z.uuid(), occurrenceId: z.uuid(), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  startsAt: utc, endsAt: utc, timezone: z.string().min(3).max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict().refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), "Meeting end must follow start");
export type CalendarRescheduleInput = z.infer<typeof calendarRescheduleInputSchema>;
export const calendarRescheduleReceiptSchema = z.object({
  operationId: z.uuid(), occurrenceId: z.uuid(), actorUserId: z.number().int().positive(), commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: calendarSnapshotSchema, recordedAt: utc, status: z.literal("rescheduled"),
  attendeeAcceptanceVerified: z.literal(false), externalInvitationsSent: z.literal(false), physicalAttendanceVerified: z.literal(false),
}).strict();
type Receipt = z.infer<typeof calendarRescheduleReceiptSchema>;
type Locked = { authorize(): Promise<void>; snapshot: CalendarSnapshot; prior: unknown; save(snapshot: CalendarSnapshot, receipt: Receipt): Promise<void> };
export function calendarCommandFingerprint(input:CalendarRescheduleInput,actorUserId:number){return createHash("sha256").update(JSON.stringify({input:calendarRescheduleInputSchema.parse(input),actorUserId})).digest("hex");}
export function createCalendarReschedule(deps: { now(): Date; transaction<T>(input: CalendarRescheduleInput, actorUserId: number, run: (locked: Locked) => Promise<T>): Promise<T> }) {
  async function perform(raw: unknown, actorUserId: number, readback: boolean) {
    const input = calendarRescheduleInputSchema.parse(raw);
    z.number().int().positive().parse(actorUserId);
    const commandFingerprint = calendarCommandFingerprint(input,actorUserId);
    return deps.transaction(input, actorUserId, async locked => {
      await locked.authorize();
      if (locked.prior !== null) {
        const prior = calendarRescheduleReceiptSchema.parse(locked.prior);
        if (prior.operationId !== input.operationId || prior.actorUserId !== actorUserId || prior.occurrenceId !== input.occurrenceId || prior.commandFingerprint !== commandFingerprint) throw Error("calendar.operation_conflict");
        return { receipt: prior, replayed: true };
      }
      if (readback) return { receipt: null, replayed: false };
      const current = calendarSnapshotSchema.parse(locked.snapshot);
      if (current.status !== "scheduled") throw Error("calendar.terminal_occurrence");
      if (calendarSnapshotFingerprint(current) !== input.expectedFingerprint) throw Error("calendar.snapshot_conflict");
      if (input.timezone !== current.timezone) throw Error("calendar.shared_timezone_change");
      const snapshot = { ...current, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone };
      const receipt = calendarRescheduleReceiptSchema.parse({ operationId: input.operationId, occurrenceId: input.occurrenceId, actorUserId, commandFingerprint, snapshot, recordedAt: deps.now().toISOString(), status: "rescheduled", attendeeAcceptanceVerified: false, externalInvitationsSent: false, physicalAttendanceVerified: false });
      await locked.save(snapshot, receipt);
      return { receipt, replayed: false };
    });
  }
  return {
    execute: (raw: unknown, actorUserId: number) => perform(raw, actorUserId, false),
    readback: (raw: unknown, actorUserId: number) => perform(raw, actorUserId, true),
    async inspect(rawOccurrenceId: unknown, actorUserId: number) {
      const occurrenceId = z.uuid().parse(rawOccurrenceId);
      // Transaction routing only: this read never stores or executes this operation.
      const input = { operationId: randomUUID(), occurrenceId, expectedFingerprint: "0".repeat(64), startsAt: "2000-01-01T00:00:00Z", endsAt: "2000-01-01T01:00:00Z", timezone: "UTC" };
      return deps.transaction(input, actorUserId, async locked => {
        await locked.authorize();
        const snapshot = calendarSnapshotSchema.parse(locked.snapshot);
        return { snapshot, fingerprint: calendarSnapshotFingerprint(snapshot), executionStarted: false as const };
      });
    },
  };
}
