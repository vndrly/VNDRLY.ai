import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  userOrgMembershipsTable,
  workHubMeetingsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function queueLiveMeetingNotification(
  tx: Tx,
  e: {
    userIds: number[];
    occurrenceId: string;
    identity: string;
    title: string;
    body: string;
  },
) {
  for (const userId of [...new Set(e.userIds)]) {
    const [prefs] = await tx
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId))
      .limit(1);
    const now = new Date();
    let next = now;
    if (
      prefs?.dndStartHour != null &&
      prefs.dndEndHour != null &&
      prefs.dndStartHour !== prefs.dndEndHour
    ) {
      const h = now.getHours(),
        s = prefs.dndStartHour,
        end = prefs.dndEndHour;
      if (s < end ? h >= s && h < end : h >= s || h < end) {
        next = new Date(now);
        next.setHours(end, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
      }
    }
    await tx
      .insert(notificationsTable)
      .values({
        userId,
        type: "work_hub_meeting_invite",
        category: "work_hub_meetings",
        title: e.title,
        body: e.body,
        link: `/work-hub/meetings/${e.occurrenceId}`,
        dedupeKey: `live-meeting:${e.occurrenceId}:${e.identity}`,
        nextDeliveryAttemptAt:
          prefs?.pushEnabled === false ||
          prefs?.workHubMeetingsEnabled === false
            ? null
            : next,
      })
      .onConflictDoNothing();
  }
}

/** Delayed delivery must not retain authority from invitation creation. */
export async function liveMeetingPushAllowed(
  userId: number,
  occurrenceId: string,
): Promise<boolean> {
  const [room] = await db
    .select({
      vendorId: workHubMeetingsTable.ownerOrgId,
      status: workHubMeetingOccurrencesTable.status,
    })
    .from(workHubMeetingOccurrencesTable)
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .where(
      and(
        eq(workHubMeetingOccurrencesTable.id, occurrenceId),
        eq(workHubMeetingsTable.ownerOrgType, "vendor"),
      ),
    )
    .limit(1);
  if (!room) return false;
  const [member] = await db
    .select({ id: usersTable.id })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId))
    .where(
      and(
        eq(usersTable.id, userId),
        isNull(usersTable.suspendedAt),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, room.vendorId),
      ),
    )
    .limit(1);
  if (!member) return false;
  const [participant] = await db
    .select()
    .from(workHubMeetingParticipantsTable)
    .where(
      and(
        eq(workHubMeetingParticipantsTable.occurrenceId, occurrenceId),
        eq(workHubMeetingParticipantsTable.userId, userId),
      ),
    )
    .limit(1);
  if (participant?.removedAt) return false;
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);
  return (
    prefs?.pushEnabled !== false && prefs?.workHubMeetingsEnabled !== false
  );
}
