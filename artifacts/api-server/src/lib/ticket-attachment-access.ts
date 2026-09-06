import { and, arrayContains, eq, isNull, or } from "drizzle-orm";
import { db, ticketNoteLogsTable } from "@workspace/db";
import type { SessionPayload } from "./session";
import { canReadTicket } from "./field-ticket-access";

export function ticketAttachmentReference(objectPath: string) {
  const apiPath = `/api/storage${objectPath}`;
  return or(
    eq(ticketNoteLogsTable.content, `[photo] ${objectPath}`),
    eq(ticketNoteLogsTable.content, `[photo] ${apiPath}`),
    arrayContains(ticketNoteLogsTable.attachments, [objectPath]),
    arrayContains(ticketNoteLogsTable.attachments, [apiPath]),
  );
}

/** A private upload is shared only by its uploader's exact, active ticket note. */
export async function canReadTicketAttachment(
  session: SessionPayload | null,
  objectPath: string,
  owner: string | undefined,
): Promise<boolean> {
  if (
    !session?.userId ||
    !owner ||
    !/^[1-9]\d*$/.test(owner) ||
    !/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath)
  )
    return false;
  const authorId = Number(owner);
  if (!Number.isSafeInteger(authorId)) return false;
  const notes = await db
    .select({ ticketId: ticketNoteLogsTable.ticketId })
    .from(ticketNoteLogsTable)
    .where(
      and(
        ticketAttachmentReference(objectPath),
        eq(ticketNoteLogsTable.createdById, authorId),
        isNull(ticketNoteLogsTable.deletedAt),
      ),
    );
  for (const ticketId of new Set(notes.map((note) => note.ticketId))) {
    if (await canReadTicket(session, ticketId)) return true;
  }
  return false;
}
