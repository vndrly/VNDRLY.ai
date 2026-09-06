import { and, desc, eq, sql } from "drizzle-orm";
import { db, assistantMessagesTable } from "@workspace/db";

/** Approval comes from a saved user turn, never a model-supplied phrase. */
export async function readVoiceConfirmation(input: {
  conversationId: number | null;
  sessionId: string;
  eventId: unknown;
  pendingCreatedAt: number | null;
}): Promise<string | null> {
  if (
    !input.conversationId ||
    input.pendingCreatedAt === null ||
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
    metadata.acceptedAt <= input.pendingCreatedAt
  )
    return null;
  return message.content?.slice(0, 300) ?? null;
}
