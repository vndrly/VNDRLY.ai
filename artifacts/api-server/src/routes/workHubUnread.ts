import { Router, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, usersTable, workHubMessagesTable, workHubMessageMetadataTable } from "@workspace/db";
import { getSessionFromRequest as session } from "../lib/session";
import { resolveChannelAccess } from "../work-hub/queries";
import { WorkHubAccessError } from "../work-hub/context-access";
import { sendApiError } from "../lib/apiError";
const router = Router();
const uuid = z.string().uuid();
function fail(res: Response, error: unknown) {
  if (error instanceof WorkHubAccessError) return sendApiError(res, error.status, error.code, error.message);
  if (error instanceof z.ZodError) return sendApiError(res, 400, "work_hub.invalid_operation", "Invalid Work Hub request");
  throw error;
}
// Preview reads supplement, rather than advance, the conversation read cursor.
export function unreadFor(channelId: string, userId: number) {
  return sql`${workHubMessagesTable.channelId} = ${channelId}
    AND ${workHubMessagesTable.authorUserId} <> ${userId}
    AND ${workHubMessagesTable.deletedAt} IS NULL
    AND NOT EXISTS (SELECT 1 FROM work_hub_read_cursors c
      WHERE c.channel_id = ${channelId} AND c.user_id = ${userId}
      AND c.seen_at >= ${workHubMessagesTable.createdAt})
    AND NOT EXISTS (SELECT 1 FROM work_hub_message_metadata m
      WHERE m.message_id = ${workHubMessagesTable.id}
      AND m.metadata->'previewReadBy'->>${String(userId)} = 'true')`;
}

router.get("/work-hub/channels/:channelId/unread", async (req, res) => {
  const actor = session(req);
  if (!actor?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  try {
    const channelId = uuid.parse(req.params.channelId);
    const page = z.coerce.number().int().min(0).max(100000).parse(req.query.page ?? 0);
    await resolveChannelAccess({ ...actor, userId: actor.userId }, channelId, "channel.read");
    const condition = unreadFor(channelId, actor.userId);
    const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(workHubMessagesTable).where(condition);
    const total = count?.total ?? 0;
    const actualPage = Math.min(page, Math.max(0, Math.ceil(total / 10) - 1));
    const messages = await db.select({ id: workHubMessagesTable.id, body: workHubMessagesTable.body,
      createdAt: workHubMessagesTable.createdAt, authorName: usersTable.displayName })
      .from(workHubMessagesTable).leftJoin(usersTable, eq(usersTable.id, workHubMessagesTable.authorUserId))
      .where(condition).orderBy(desc(workHubMessagesTable.createdAt), desc(workHubMessagesTable.id))
      .limit(10).offset(actualPage * 10);
    return res.json({ messages, total, page: actualPage, hasNext: (actualPage + 1) * 10 < total });
  } catch (error) { return fail(res, error); }
});

router.put("/work-hub/channels/:channelId/messages/:messageId/read", async (req, res) => {
  const actor = session(req);
  if (!actor?.userId) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
  try {
    const channelId = uuid.parse(req.params.channelId), messageId = uuid.parse(req.params.messageId);
    await resolveChannelAccess({ ...actor, userId: actor.userId }, channelId, "channel.read");
    const [message] = await db.select({ id: workHubMessagesTable.id }).from(workHubMessagesTable)
      .where(and(eq(workHubMessagesTable.id, messageId), eq(workHubMessagesTable.channelId, channelId))).limit(1);
    if (!message) throw new WorkHubAccessError("not_found");
    // Atomic nested merge preserves other readers and unrelated metadata.
    await db.insert(workHubMessageMetadataTable).values({ messageId,
      metadata: { previewReadBy: { [String(actor.userId)]: true } } })
      .onConflictDoUpdate({ target: workHubMessageMetadataTable.messageId,
        set: { metadata: sql`jsonb_set(${workHubMessageMetadataTable.metadata}, '{previewReadBy}',
          COALESCE(${workHubMessageMetadataTable.metadata}->'previewReadBy', '{}'::jsonb)
          || ${JSON.stringify({ [String(actor.userId)]: true })}::jsonb)` } });
    return res.json({ messageId, read: true });
  } catch (error) { return fail(res, error); }
});

export default router;
