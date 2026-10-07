import { and, eq, isNull, sql } from "drizzle-orm";
import { db, workHubMeetingsTable as meetings, workHubMeetingOccurrencesTable as occurrences, workHubMeetingParticipantsTable as participants, workHubClientOperationsTable as operations, workHubAuditLogTable as audit } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { createWorkHubAccess, requireWorkHubCapability } from "../work-hub/context-access";
import { calendarSnapshotSchema, createCalendarReschedule } from "./calendar-reschedule";
import { notifyUsers } from "../routes/notifications";

/** Existing durable Work Hub receipt storage; no provider or meeting version is invented. */
export function calendarRescheduleForSession(session: SessionPayload) {
  const userId = session.userId;
  if (!userId || !session.activeMembershipId || !session.sv) throw Error("calendar.forbidden");
  const service = createCalendarReschedule({ now: () => new Date(), transaction: (input, actorUserId, run) => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar-reschedule:${actorUserId}:${input.operationId}`},0))`);
    const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, input.occurrenceId)).for("update");
    if (!occurrence) throw Error("calendar.forbidden");
    const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, occurrence.meetingId)).for("update");
    if (!meeting || !["vendor", "partner"].includes(meeting.ownerOrgType)) throw Error("calendar.forbidden");
    const people = await tx.select().from(participants).where(eq(participants.occurrenceId, occurrence.id)).for("update");
    const prior = await tx.select().from(operations).where(and(eq(operations.userId, actorUserId), eq(operations.operationId, input.operationId), eq(operations.commandKind, "calendar.reschedule")));
    if (prior.length > 1 || prior.length === 1 && (prior[0].ownerOrgType !== meeting.ownerOrgType || prior[0].ownerOrgId !== meeting.ownerOrgId || !prior[0].resultJson)) throw Error("calendar.operation_conflict");
    const snapshot = calendarSnapshotSchema.parse({ occurrenceId: occurrence.id, meetingId: meeting.id, ownerType: meeting.ownerOrgType, ownerId: meeting.ownerOrgId, title: meeting.title, agenda: meeting.agenda, timezone: meeting.timezone, createdById: meeting.createdById, startsAt: occurrence.startsAt.toISOString(), endsAt: occurrence.endsAt?.toISOString() ?? null, status: occurrence.status, participantUserIds: people.filter(person => !person.removedAt).map(person => person.userId) });
    return run({ snapshot, prior: prior[0]?.resultJson ?? null,
      async authorize() {
        // Hold the identity and active membership against revocation throughout the write.
        await tx.execute(sql`select id from users where id=${actorUserId} for share`);
        await tx.execute(sql`select id from user_org_memberships where id=${session.activeMembershipId ?? 0} for share`);
        const current = await validateAssistantSession(session, tx);
        const own = meeting.ownerOrgType === "vendor" ? current.vendorId === meeting.ownerOrgId : current.partnerId === meeting.ownerOrgId;
        if (!own || current.userId !== actorUserId || !people.some(person => person.userId === actorUserId && !person.removedAt)) throw Error("calendar.forbidden");
        requireWorkHubCapability(createWorkHubAccess({ session: { ...current, userId: actorUserId }, owner: { type: meeting.ownerOrgType as "vendor" | "partner", id: meeting.ownerOrgId }, context: { kind: "organization", id: meeting.ownerOrgId }, participant: true }), "meeting.host");
        if (meeting.createdById !== actorUserId && current.membershipRole !== "admin") throw Error("calendar.forbidden");
      },
      async save(next, receipt) {
        await tx.update(occurrences).set({ startsAt: new Date(next.startsAt), endsAt: new Date(next.endsAt!) }).where(eq(occurrences.id, occurrence.id));
        // A response to the old schedule cannot establish acceptance of this one.
        await tx.update(participants).set({ rsvp: "pending" }).where(and(eq(participants.occurrenceId, occurrence.id), isNull(participants.removedAt)));
        await tx.insert(operations).values({ userId: actorUserId, operationId: input.operationId, commandKind: "calendar.reschedule", ownerOrgType: meeting.ownerOrgType, ownerOrgId: meeting.ownerOrgId, resultJson: receipt, appliedAt: new Date(receipt.recordedAt) });
        await tx.insert(audit).values({ actorUserId, ownerOrgType: meeting.ownerOrgType, ownerOrgId: meeting.ownerOrgId, action: "calendar.reschedule", subjectType: "meeting_occurrence", subjectId: occurrence.id, source: "canonical_api", operationId: input.operationId, metadata: receipt });
      },
    });
  }) });
  return {
    inspect: (occurrenceId: unknown) => service.inspect(occurrenceId, userId),
    readback: (raw: unknown) => service.readback(raw, userId),
    async execute(raw: unknown) {
      const result = await service.execute(raw, userId);
      if (result.receipt && !result.replayed) {
        // Best effort after commit, no replay storm and no delivery or RSVP claim.
        try { await notifyUsers(result.receipt.snapshot.participantUserIds.filter(id => id !== session.userId), { type: "work_hub_meeting_invite", category: "system", title: "Meeting rescheduled", body: result.receipt.snapshot.title, link: `/work-hub/meetings/${result.receipt.occurrenceId}`, dedupeKey: `calendar-reschedule:${result.receipt.operationId}` }); } catch { /* Saved outcome remains recoverable. */ }
      }
      return result;
    },
  };
}
