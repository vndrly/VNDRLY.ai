import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  workHubFileLibraryTable as library,
  workHubMeetingChatTable as chat,
  workHubMeetingParticipantsTable as participants,
  workHubMeetingOccurrencesTable as occurrences,
  workHubMeetingsTable as meetings,
} from "@workspace/db";
import { LibraryError, type LibraryTx } from "./library-core";
import type { SessionPayload } from "../lib/session";
import { sessionCanSeeOwner } from "./owner-boundary";
import { requireRoomAdmission } from "./live-meetings";
import { canReadMeetingMessage } from "./meeting-collaboration";
export async function meetingRepositoryAccess(
  reader: Pick<typeof db, "select">,
  actor: SessionPayload & { userId: number },
  document: { data: Record<string, any>; orgType: string; orgId: number },
  manage = false,
) {
  const [row] = await reader
    .select({ message: chat, meeting: meetings })
    .from(chat)
    .innerJoin(occurrences, eq(occurrences.id, chat.occurrenceId))
    .innerJoin(meetings, eq(meetings.id, occurrences.meetingId))
    .innerJoin(
      participants,
      and(
        eq(participants.occurrenceId, occurrences.id),
        eq(participants.userId, actor.userId),
        isNull(participants.removedAt),
      ),
    )
    .where(eq(chat.id, String(document.data.sourceMeetingFileId)));
  if (
    !row ||
    row.meeting.ownerOrgType !== document.orgType ||
    row.meeting.ownerOrgId !== document.orgId ||
    !sessionCanSeeOwner(actor, document.orgType, document.orgId) ||
    !canReadMeetingMessage(
      actor.userId,
      row.message.userId,
      row.message.recipientUserId,
    ) ||
    row.message.attachment?.removedAt
  )
    throw new LibraryError("File not found", 404);
  if (row.meeting.admissionMode)
    await requireRoomAdmission(
      reader as LibraryTx,
      actor,
      row.message.occurrenceId,
    );
  if (manage && row.message.userId !== actor.userId)
    throw new LibraryError(
      "Only the uploader may classify this meeting file",
      403,
    );
  return row.message;
}
export async function indexMeetingRepositoryFile(
  tx: LibraryTx,
  message: typeof chat.$inferSelect,
  owner: { type: string; id: number },
) {
  const a = message.attachment;
  if (!a || a.removedAt) return;
  await tx
    .insert(library)
    .values({
      id: message.id,
      orgType: owner.type,
      orgId: owner.id,
      kind: "document",
      recordKey: `meeting-file:${message.id}`,
      createdBy: message.userId,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      data: {
        name: a.fileName,
        contentType: a.contentType,
        byteSize: a.byteSize,
        scope: "meeting",
        state: "active",
        sourceMeetingFileId: message.id,
        occurrenceId: message.occurrenceId,
        currentFileId: message.id,
        versions: [message.id],
        version: 1,
        uploadSource: "meeting",
        purpose: null,
        categoryIds: [],
        folderId: null,
        tripId: null,
      },
    })
    .onConflictDoNothing();
}
