import { createHash } from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, usersTable, workHubMessagesTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { appendWorkHubAudit } from "./audit";
import { answerMeetingQuestion } from "./meeting-answer";
import { buildMeetingAnswerInput, parseMeetingWakeQuestion, selectMeetingAnswerContext } from "./meeting-answer-context";
import { resolveChannelAccess } from "./queries";

export const CHANNEL_ASSISTANT_MESSAGE_KIND = "askv_answer";

type Message = typeof workHubMessagesTable.$inferSelect;

export async function answerChannelQuestion(actor: SessionPayload & { userId: number }, source: Message) {
  if (source.kind !== "text" || source.deletedAt || source.authorUserId !== actor.userId) return;
  if (!/^(?:hey\s+v|ask\s*v)(?=$|[\s,.:;!?—–-])/i.test(source.body.trim())) return;
  const question = parseMeetingWakeQuestion(source.body);
  if (!question || question.length > 2_000) return;

  // Deterministic for this invocation, including when the original send is retried.
  const hash = createHash("sha256").update(`channel-askv:${source.id}`).digest("hex");
  const answerId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const currentActor = await validateAssistantSession(actor, db);
  if (currentActor.userId !== actor.userId) return;
  await resolveChannelAccess({ ...currentActor, userId: actor.userId }, source.channelId, "channel.write");
  const [prior] = await db.select({ id: workHubMessagesTable.id }).from(workHubMessagesTable)
    .where(eq(workHubMessagesTable.id, answerId)).limit(1);
  if (prior) return;

  const sourceWhere = and(eq(workHubMessagesTable.id, source.id), eq(workHubMessagesTable.channelId, source.channelId),
    eq(workHubMessagesTable.authorUserId, actor.userId), eq(workHubMessagesTable.version, source.version),
    eq(workHubMessagesTable.body, source.body), isNull(workHubMessagesTable.deletedAt));
  const [currentSource] = await db.select({ id: workHubMessagesTable.id }).from(workHubMessagesTable).where(sourceWhere).limit(1);
  if (!currentSource) return;

  const thread = source.rootMessageId
    ? or(eq(workHubMessagesTable.rootMessageId, source.rootMessageId), eq(workHubMessagesTable.id, source.rootMessageId))
    : isNull(workHubMessagesTable.rootMessageId);
  const rows = await db.select({
    id: workHubMessagesTable.id,
    userId: workHubMessagesTable.authorUserId,
    speaker: usersTable.displayName,
    text: workHubMessagesTable.body,
    createdAt: workHubMessagesTable.createdAt,
  }).from(workHubMessagesTable)
    .innerJoin(usersTable, eq(usersTable.id, workHubMessagesTable.authorUserId))
    .where(and(eq(workHubMessagesTable.channelId, source.channelId), isNull(workHubMessagesTable.deletedAt),
      eq(workHubMessagesTable.kind, "text"), thread))
    .orderBy(desc(workHubMessagesTable.createdAt), desc(workHubMessagesTable.id)).limit(40);
  const selected = selectMeetingAnswerContext({
    audience: "shared",
    requesterUserId: actor.userId,
    rows: rows.map(row => ({ ...row, kind: "chat", recipientUserId: null, occurredAt: row.createdAt.getTime() })),
    maxBytes: 40 * 1024,
  });
  const signal = AbortSignal.timeout(25_000);
  const answer = await answerMeetingQuestion(buildMeetingAnswerInput({ question, audience: "shared", selected }), signal, "chat");
  await db.transaction(async tx => {
    signal.throwIfAborted();
    const freshActor = await validateAssistantSession(actor, tx);
    if (freshActor.userId !== actor.userId) return;
    const { channel } = await resolveChannelAccess({ ...freshActor, userId: actor.userId }, source.channelId, "channel.write", tx);
    const [savedSource] = await tx.select({ id: workHubMessagesTable.id }).from(workHubMessagesTable)
      .where(sourceWhere).for("share").limit(1);
    if (!savedSource) return;

    const [saved] = await tx.insert(workHubMessagesTable).values({
      id: answerId, channelId: channel.id, authorUserId: actor.userId,
      clientOperationId: answerId, kind: CHANNEL_ASSISTANT_MESSAGE_KIND, body: answer,
      rootMessageId: source.rootMessageId, parentMessageId: source.parentMessageId,
    }).onConflictDoNothing().returning({ id: workHubMessagesTable.id });
    if (!saved) return;
    await appendWorkHubAudit({
      actorUserId: actor.userId, owner: { type: channel.ownerOrgType as "vendor" | "partner", id: channel.ownerOrgId },
      action: "message.askv_answered", subjectType: "message", subjectId: saved.id, source: "askv",
      operationId: answerId, metadata: { sourceMessageId: source.id },
    }, tx);
  });
}
