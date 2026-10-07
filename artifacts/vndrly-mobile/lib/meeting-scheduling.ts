import { z } from "zod/v4";
import { WorkHubCalendarResponseObservationSchema } from "@workspace/api-zod";

// Reject daylight-saving gaps and repeated local times rather than guessing an offset.
export function localMeetingTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("invalid_local_time");
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  const value = new Date(y, m - 1, d, h, min);
  const matches = (v: Date) =>
    v.getFullYear() === y &&
    v.getMonth() === m - 1 &&
    v.getDate() === d &&
    v.getHours() === h &&
    v.getMinutes() === min;
  if (!matches(value)) throw new Error("invalid_local_time");
  // Minute-resolution input: detect another occurrence within the full 24-hour
  // civil-offset transition range, including Lord Howe's half-hour fold.
  for (let minutes = 1; minutes <= 1440; minutes++) {
    if (
      matches(new Date(value.getTime() - minutes * 60000)) ||
      matches(new Date(value.getTime() + minutes * 60000))
    )
      throw new Error("invalid_local_time");
  }
  return value.toISOString();
}

const payloadSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().min(3).max(80),
    participantUserIds: z.array(z.number().int().positive()).max(99),
    recordingAllowed: z.literal(false),
  })
  .strict();
export type MeetingAttempt = {
  actorUserId: number;
  body: {
    operationId: string;
    owner: { type: "vendor" | "partner"; id: number };
    context: { kind: "organization"; id: number };
    payload: z.infer<typeof payloadSchema>;
  };
  baseline: string[];
};
export function makeMeetingAttempt(
  actorUserId: number,
  owner: MeetingAttempt["body"]["owner"],
  input: unknown,
  operationId: string,
  baseline: string[],
): MeetingAttempt {
  const payload = payloadSchema.parse(input);
  z.uuid().parse(operationId);
  if (Date.parse(payload.endsAt) <= Date.parse(payload.startsAt))
    throw new Error("End must be after start");
  new Intl.DateTimeFormat("en", { timeZone: payload.timezone }).format();
  return {
    actorUserId,
    body: {
      operationId,
      owner,
      context: { kind: "organization", id: owner.id },
      payload: {
        ...payload,
        participantUserIds: [...new Set(payload.participantUserIds)].sort(
          (a, b) => a - b,
        ),
      },
    },
    baseline: [...baseline],
  };
}
export function meetingCalendarPath(start: string, end: string) {
  return `/api/work-hub/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}
export function meetingIds(raw: unknown): string[] {
  const data = z
    .object({
      meetings: z.array(
        z.object({
          item: z.object({ occurrence: z.object({ id: z.uuid() }) }),
        }),
      ),
    })
    .parse(raw);
  return data.meetings.map((r) => r.item.occurrence.id);
}
export function matchingMeeting(raw: unknown, attempt: MeetingAttempt) {
  const value = WorkHubCalendarResponseObservationSchema.parse(raw);
  const s = value.snapshot,
    p = attempt.body.payload;
  const participants = [
    ...new Set([attempt.actorUserId, ...p.participantUserIds]),
  ].sort((a, b) => a - b);
  if (
    value.actorUserId !== attempt.actorUserId ||
    !value.canManage ||
    s.createdById !== attempt.actorUserId ||
    s.ownerType !== attempt.body.owner.type ||
    s.ownerId !== attempt.body.owner.id ||
    s.title !== p.title ||
    s.timezone !== p.timezone ||
    Date.parse(s.startsAt) !== Date.parse(p.startsAt) ||
    Date.parse(s.endsAt ?? "") !== Date.parse(p.endsAt) ||
    s.status !== "scheduled" ||
    JSON.stringify([...s.participantUserIds].sort((a, b) => a - b)) !==
      JSON.stringify(participants)
  )
    throw new Error("Saved meeting differs from review");
  return s.occurrenceId;
}
export function createdMeetingId(raw: unknown, attempt: MeetingAttempt) {
  const r = z
    .object({
      operationId: z.uuid(),
      appliedAt: z.iso.datetime(),
      replayed: z.boolean(),
      resource: z.object({
        meeting: z.object({ id: z.uuid() }),
        occurrence: z.object({ id: z.uuid() }),
      }),
    })
    .parse(raw);
  if (r.operationId !== attempt.body.operationId)
    throw new Error("Operation differs from review");
  return r.resource.occurrence.id;
}
