import { and, desc, eq, sql } from "drizzle-orm";
import { db, assistantMessagesTable } from "@workspace/db";

/** User evidence comes from a saved user turn, never a model-supplied phrase. */
export async function readBoundVoiceUtterance(input: {
  conversationId: number | null;
  sessionId: string;
  eventId: unknown;
  acceptedAfter?: number | null;
}): Promise<string | null> {
  if (
    !input.conversationId ||
    typeof input.eventId !== "string"
  )
    return null;
  const [message] = await db
    .select({
      content: assistantMessagesTable.content,
      toolCalls: assistantMessagesTable.toolCalls,
    })
    .from(assistantMessagesTable)
    .where(
      and(
        eq(assistantMessagesTable.conversationId, input.conversationId),
        eq(assistantMessagesTable.role, "user"),
        sql`${assistantMessagesTable.toolCalls}->>'voiceSessionId' = ${input.sessionId}`,
      ),
    )
    .orderBy(
      desc(assistantMessagesTable.createdAt),
      desc(assistantMessagesTable.id),
    )
    .limit(1);
  const metadata = message?.toolCalls as {
    voiceEventId?: string;
    acceptedAt?: number;
  } | null;
  if (
    metadata?.voiceEventId !== input.eventId ||
    typeof metadata.acceptedAt !== "number" ||
    (input.acceptedAfter != null && metadata.acceptedAt <= input.acceptedAfter)
  )
    return null;
  return message.content?.slice(0, 300) ?? null;
}

/** Approval comes from a user turn saved after the pending action was created. */
export async function readVoiceConfirmation(input: {
  conversationId: number | null;
  sessionId: string;
  eventId: unknown;
  pendingCreatedAt: number | null;
}): Promise<string | null> {
  if (input.pendingCreatedAt === null) return null;
  return readBoundVoiceUtterance({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    eventId: input.eventId,
    acceptedAfter: input.pendingCreatedAt,
  });
}
