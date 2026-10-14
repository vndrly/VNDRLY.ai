import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  workHubCallsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingsTable,
  vendorsTable,
  userOrgMembershipsTable,
  usersTable,
} from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { WorkHubAccessError } from "./context-access";
import { callTranscriptDecision } from "./call-transcript-policy";

export async function authorizeCallTranscript(
  actor: SessionPayload & { userId: number },
  callId: string,
  mode: "read" | "capture" | "voicemail",
  reader: Pick<typeof db, "select"> = db,
  internalWorker = false,
) {
  if (!actor.vendorId) throw new WorkHubAccessError("forbidden");
  const [row] = await reader
    .select({
      call: workHubCallsTable,
      meeting: workHubMeetingsTable,
      occurrence: workHubMeetingOccurrencesTable,
      policy: vendorsTable.callTranscriptionPolicy,
    })
    .from(workHubCallsTable)
    .innerJoin(
      workHubMeetingOccurrencesTable,
      eq(workHubMeetingOccurrencesTable.id, workHubCallsTable.occurrenceId),
    )
    .innerJoin(
      workHubMeetingsTable,
      eq(workHubMeetingsTable.id, workHubMeetingOccurrencesTable.meetingId),
    )
    .innerJoin(
      vendorsTable,
      eq(vendorsTable.id, workHubMeetingsTable.ownerOrgId),
    )
    .where(
      and(
        eq(workHubCallsTable.id, callId),
        eq(workHubMeetingsTable.ownerOrgType, "vendor"),
        eq(workHubMeetingsTable.ownerOrgId, actor.vendorId),
      ),
    )
    .limit(1);
  if (!row) throw new WorkHubAccessError("not_found");
  const memberships = await reader
    .select()
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, actor.vendorId),
        inArray(userOrgMembershipsTable.userId, [
          actor.userId,
          row.call.callerUserId,
          row.call.recipientUserId,
        ]),
      ),
    );
  const currentUsers = await reader
    .select({
      id: usersTable.id,
      sessionVersion: usersTable.sessionVersion,
      activeMembershipId: usersTable.activeMembershipId,
    })
    .from(usersTable)
    .where(
      and(
        inArray(
          usersTable.id,
          memberships.map((m) => m.userId),
        ),
        isNull(usersTable.suspendedAt),
      ),
    );
  const currentActor = currentUsers.find((u) => u.id === actor.userId);
  if (
    !internalWorker &&
    (!currentActor ||
      !actor.sv ||
      currentActor.sessionVersion !== actor.sv ||
      (currentActor.activeMembershipId !== null &&
        currentActor.activeMembershipId !== actor.activeMembershipId))
  )
    throw new WorkHubAccessError("forbidden");
  if (
    !callTranscriptDecision(
      {
        vendorId: actor.vendorId,
        ownerVendorId: row.meeting.ownerOrgId,
        actorUserId: actor.userId,
        callerUserId: row.call.callerUserId,
        recipientUserId: row.call.recipientUserId,
        memberIds: currentUsers.map((m) => m.id),
        admin: memberships.some(
          (m) => m.userId === actor.userId && m.role === "admin",
        ),
        active: row.call.status === "active",
        policy: row.policy,
      },
      mode,
    )
  )
    throw new WorkHubAccessError("forbidden");
  return row;
}
