import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  workHubMeetingsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
  workHubShiftsTable,
  workHubShiftAssignmentsTable,
} from "@workspace/db";
import { overlaps } from "./scheduling-policy";

export type ParticipantBusyInterval = {
  userId: number;
  kind: "meeting" | "shift";
  startsAt: Date;
  endsAt: Date;
};

export type AvailableMeetingTime = {
  startsAt: Date;
  endsAt: Date;
};

export function requestedMeetingAvailability(
  startsAt: Date,
  endsAt: Date,
  busy: ParticipantBusyInterval[],
) {
  const conflicts = busy.filter((item) =>
    overlaps(startsAt, endsAt, item.startsAt, item.endsAt),
  );
  return { available: conflicts.length === 0, conflicts };
}

export function findAvailableMeetingTimes(input: {
  searchStart: Date;
  searchEnd: Date;
  durationMinutes: number;
  busy: ParticipantBusyInterval[];
  limit?: number;
  stepMinutes?: number;
}): AvailableMeetingTime[] {
  const durationMs = input.durationMinutes * 60_000;
  const stepMs = (input.stepMinutes ?? 15) * 60_000;
  const limit = Math.min(Math.max(input.limit ?? 3, 1), 10);
  const slots: AvailableMeetingTime[] = [];
  const alignedStart = Math.ceil(input.searchStart.getTime() / stepMs) * stepMs;

  for (
    let cursor = alignedStart;
    cursor + durationMs <= input.searchEnd.getTime() && slots.length < limit;
    cursor += stepMs
  ) {
    const startsAt = new Date(cursor);
    const endsAt = new Date(cursor + durationMs);
    if (requestedMeetingAvailability(startsAt, endsAt, input.busy).available)
      slots.push({ startsAt, endsAt });
  }
  return slots;
}

type Owner = { type: "vendor" | "partner"; id: number };
type DatabaseExecutor = Pick<typeof db, "select">;

export async function getParticipantBusyIntervals(
  executor: DatabaseExecutor,
  owner: Owner,
  userIds: number[],
  searchStart: Date,
  searchEnd: Date,
): Promise<ParticipantBusyInterval[]> {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return [];

  const meetingRows = await executor
    .select({
      userId: workHubMeetingParticipantsTable.userId,
      startsAt: workHubMeetingOccurrencesTable.startsAt,
      endsAt: workHubMeetingOccurrencesTable.endsAt,
    })
    .from(workHubMeetingOccurrencesTable)
    .innerJoin(
      workHubMeetingParticipantsTable,
      eq(
        workHubMeetingParticipantsTable.occurrenceId,
        workHubMeetingOccurrencesTable.id,
      ),
    )
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .where(
      and(
        eq(workHubMeetingsTable.ownerOrgType, owner.type),
        eq(workHubMeetingsTable.ownerOrgId, owner.id),
        inArray(workHubMeetingParticipantsTable.userId, uniqueIds),
        sql`${workHubMeetingOccurrencesTable.status} <> 'cancelled'`,
        sql`${workHubMeetingParticipantsTable.rsvp} <> 'declined'`,
        sql`${workHubMeetingParticipantsTable.removedAt} is null`,
        sql`${workHubMeetingOccurrencesTable.startsAt} < ${searchEnd}`,
        sql`coalesce(${workHubMeetingOccurrencesTable.endsAt}, ${workHubMeetingOccurrencesTable.startsAt} + interval '1 hour') > ${searchStart}`,
      ),
    );

  const shiftRows = await executor
    .select({
      userId: workHubShiftAssignmentsTable.userId,
      startsAt: workHubShiftsTable.startsAt,
      endsAt: workHubShiftsTable.endsAt,
    })
    .from(workHubShiftAssignmentsTable)
    .innerJoin(
      workHubShiftsTable,
      eq(workHubShiftsTable.id, workHubShiftAssignmentsTable.shiftId),
    )
    .where(
      and(
        eq(workHubShiftsTable.ownerOrgType, owner.type),
        eq(workHubShiftsTable.ownerOrgId, owner.id),
        inArray(workHubShiftAssignmentsTable.userId, uniqueIds),
        sql`${workHubShiftAssignmentsTable.status} not in ('cancelled', 'declined')`,
        sql`${workHubShiftsTable.milestoneStatus} <> 'cancelled'`,
        sql`${workHubShiftsTable.startsAt} < ${searchEnd}`,
        sql`${workHubShiftsTable.endsAt} > ${searchStart}`,
      ),
    );

  return [
    ...meetingRows.map((row) => ({
      userId: row.userId,
      kind: "meeting" as const,
      startsAt: row.startsAt,
      endsAt: row.endsAt ?? new Date(row.startsAt.getTime() + 3_600_000),
    })),
    ...shiftRows.map((row) => ({
      userId: row.userId,
      kind: "shift" as const,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
  ].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}
