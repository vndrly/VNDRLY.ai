import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import {
  assistantConversationsTable,
  assistantMessagesTable,
  db,
  notificationsTable,
  vendorPeopleTable,
} from "@workspace/db";
import { parseTicketIdFromNotificationLink } from "../lib/parse-ticket-href";
import { sendApiError } from "../lib/apiError";
import { getSessionFromRequest } from "../lib/session";
import { logger } from "../lib/logger";
import {
  actorCanSendToContext,
  actorCanSendToTicket,
  listSendToRecipients,
  listSendToRecipientsForContext,
  sendAskVShare,
  sendTicketForward,
  type SendToActor,
} from "../lib/ticket-send-to";

type Session = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  displayName?: string;
};

function getSession(req: Request): Session | null {
  const session = getSessionFromRequest(req);
  if (!session?.userId || typeof session.role !== "string") return null;
  return {
    userId: session.userId,
    role: session.role,
    vendorId: typeof session.vendorId === "number" ? session.vendorId : null,
    partnerId: typeof session.partnerId === "number" ? session.partnerId : null,
    displayName: typeof session.displayName === "string" ? session.displayName : undefined,
  };
}

async function getFieldEmployeeForSession(req: Request) {
  const session = getSession(req);
  if (!session || session.role !== "field_employee") return null;
  const [fe] = await db
    .select({
      id: vendorPeopleTable.id,
      vendorId: vendorPeopleTable.vendorId,
      userId: vendorPeopleTable.userId,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.userId, session.userId),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
      ),
    );
  if (!fe?.userId) return null;
  return { ...fe, userId: fe.userId };
}

function toActor(session: Session, fieldEmployee: Awaited<ReturnType<typeof getFieldEmployeeForSession>>): SendToActor {
  return {
    userId: session.userId,
    role: session.role,
    vendorId: session.vendorId,
    partnerId: session.partnerId,
    displayName: session.displayName,
    fieldEmployee,
  };
}

function parseRecipientIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length === raw.length ? ids : null;
}

function parseOptionalTicketId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

function truncateShareText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

async function loadAssistantShareContext(messageId: number, userId: number) {
  const [row] = await db
    .select({
      messageId: assistantMessagesTable.id,
      role: assistantMessagesTable.role,
      content: assistantMessagesTable.content,
      conversationId: assistantMessagesTable.conversationId,
      ownerUserId: assistantConversationsTable.userId,
    })
    .from(assistantMessagesTable)
    .innerJoin(
      assistantConversationsTable,
      eq(assistantMessagesTable.conversationId, assistantConversationsTable.id),
    )
    .where(eq(assistantMessagesTable.id, messageId));

  if (!row || row.ownerUserId !== userId || row.role !== "assistant") return null;

  const [priorUser] = await db
    .select({ content: assistantMessagesTable.content })
    .from(assistantMessagesTable)
    .where(
      and(
        eq(assistantMessagesTable.conversationId, row.conversationId),
        eq(assistantMessagesTable.role, "user"),
        lt(assistantMessagesTable.id, row.messageId),
      ),
    )
    .orderBy(desc(assistantMessagesTable.id))
    .limit(1);

  const question = priorUser?.content?.trim() || "Shared AskV answer";
  return {
    sourceTitle: truncateShareText(`AskV — ${question}`, 200),
    sourceBody: truncateShareText(row.content, 1500),
  };
}

const router: IRouter = Router();

/** GET /api/tickets/:id/send-to-recipients — role-scoped recipient roster. */
router.get("/tickets/:id/send-to-recipients", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid ticket id");
    return;
  }

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);
  const allowed = await actorCanSendToTicket(ticketId, actor);
  if (!allowed) {
    sendApiError(res, 403, "send_to.forbidden", "Not allowed to send from this ticket");
    return;
  }

  try {
    const groups = await listSendToRecipients(ticketId, actor);
    res.json({ groups });
  } catch (err) {
    logger.error({ err, ticketId, userId: session.userId }, "send-to recipients lookup failed");
    sendApiError(res, 500, "send_to.load_failed", "Could not load send-to recipients");
  }
});

/** POST /api/tickets/:id/send-to — forward ticket context to selected users. */
router.post("/tickets/:id/send-to", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid ticket id");
    return;
  }

  const recipientUserIds = parseRecipientIds((req.body ?? {}).recipientUserIds);
  if (!recipientUserIds) {
    sendApiError(res, 400, "validation.invalid_body", "recipientUserIds must be an array of user ids");
    return;
  }

  const message =
    typeof (req.body ?? {}).message === "string"
      ? (req.body as { message: string }).message.trim().slice(0, 500)
      : null;

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);

  const result = await sendTicketForward({
    ticketId,
    actor,
    recipientUserIds,
    message,
    sourceTitle: typeof (req.body ?? {}).sourceTitle === "string" ? (req.body as { sourceTitle: string }).sourceTitle : null,
    sourceBody: typeof (req.body ?? {}).sourceBody === "string" ? (req.body as { sourceBody: string }).sourceBody : null,
  });

  if (!result.ok) {
    const status =
      result.code === "send_to.forbidden" || result.code === "send_to.forbidden_recipient"
        ? 403
        : 400;
    sendApiError(res, status, result.code, result.message);
    return;
  }

  res.json({
    ok: true,
    notifiedCount: result.notifiedCount,
    trackingNumber: result.trackingNumber,
  });
});

/** GET /api/notifications/:id/send-to-recipients — roster for a notification's ticket. */
router.get("/notifications/:id/send-to-recipients", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const notificationId = Number(req.params.id);
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid notification id");
    return;
  }

  const [row] = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      link: notificationsTable.link,
    })
    .from(notificationsTable)
    .where(eq(notificationsTable.id, notificationId));

  if (!row || row.userId !== session.userId) {
    sendApiError(res, 404, "notification.not_found", "Notification not found");
    return;
  }

  const ticketId = parseTicketIdFromNotificationLink(row.link ?? "");
  if (ticketId === null) {
    sendApiError(
      res,
      400,
      "send_to.no_ticket",
      "This notification is not linked to a ticket",
    );
    return;
  }

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);
  const allowed = await actorCanSendToTicket(ticketId, actor);
  if (!allowed) {
    sendApiError(res, 403, "send_to.forbidden", "Not allowed to send from this ticket");
    return;
  }

  try {
    const groups = await listSendToRecipients(ticketId, actor);
    res.json({ ticketId, groups });
  } catch (err) {
    logger.error(
      { err, ticketId, notificationId, userId: session.userId },
      "send-to recipients lookup failed",
    );
    sendApiError(res, 500, "send_to.load_failed", "Could not load send-to recipients");
  }
});

/** POST /api/notifications/:id/send-to — forward an inbox row's context. */
router.post("/notifications/:id/send-to", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const notificationId = Number(req.params.id);
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid notification id");
    return;
  }

  const [row] = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      title: notificationsTable.title,
      body: notificationsTable.body,
      link: notificationsTable.link,
    })
    .from(notificationsTable)
    .where(eq(notificationsTable.id, notificationId));

  if (!row || row.userId !== session.userId) {
    sendApiError(res, 404, "notification.not_found", "Notification not found");
    return;
  }

  const ticketId = parseTicketIdFromNotificationLink(row.link ?? "");
  if (ticketId === null) {
    sendApiError(
      res,
      400,
      "send_to.no_ticket",
      "This notification is not linked to a ticket",
    );
    return;
  }

  const recipientUserIds = parseRecipientIds((req.body ?? {}).recipientUserIds);
  if (!recipientUserIds) {
    sendApiError(res, 400, "validation.invalid_body", "recipientUserIds must be an array of user ids");
    return;
  }

  const message =
    typeof (req.body ?? {}).message === "string"
      ? (req.body as { message: string }).message.trim().slice(0, 500)
      : null;

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);

  const result = await sendTicketForward({
    ticketId,
    actor,
    recipientUserIds,
    message,
    sourceTitle: row.title,
    sourceBody: row.body,
  });

  if (!result.ok) {
    const status =
      result.code === "send_to.forbidden" || result.code === "send_to.forbidden_recipient"
        ? 403
        : 400;
    sendApiError(res, status, result.code, result.message);
    return;
  }

  res.json({
    ok: true,
    notifiedCount: result.notifiedCount,
    trackingNumber: result.trackingNumber,
    ticketId,
  });
});

/** GET /api/assistant/messages/:id/send-to-recipients — AskV share roster. */
router.get("/assistant/messages/:id/send-to-recipients", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const messageId = Number(req.params.id);
  if (!Number.isInteger(messageId) || messageId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid message id");
    return;
  }

  const ticketId = parseOptionalTicketId(req.query.ticketId);

  const [row] = await db
    .select({
      id: assistantMessagesTable.id,
      role: assistantMessagesTable.role,
      ownerUserId: assistantConversationsTable.userId,
    })
    .from(assistantMessagesTable)
    .innerJoin(
      assistantConversationsTable,
      eq(assistantMessagesTable.conversationId, assistantConversationsTable.id),
    )
    .where(eq(assistantMessagesTable.id, messageId));

  if (!row || row.ownerUserId !== session.userId || row.role !== "assistant") {
    sendApiError(res, 404, "assistant.message_not_found", "Assistant message not found");
    return;
  }

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);
  const allowed = await actorCanSendToContext(ticketId, actor);
  if (!allowed) {
    sendApiError(res, 403, "send_to.forbidden", "Not allowed to share this message");
    return;
  }

  try {
    const groups = await listSendToRecipientsForContext(ticketId, actor);
    res.json({ ticketId, groups });
  } catch (err) {
    logger.error({ err, messageId, ticketId, userId: session.userId }, "askv send-to recipients lookup failed");
    sendApiError(res, 500, "send_to.load_failed", "Could not load send-to recipients");
  }
});

/** POST /api/assistant/messages/:id/send-to — share an AskV answer via notifications. */
router.post("/assistant/messages/:id/send-to", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    sendApiError(res, 401, "auth.required", "Authentication required");
    return;
  }

  const messageId = Number(req.params.id);
  if (!Number.isInteger(messageId) || messageId < 1) {
    sendApiError(res, 400, "validation.invalid_id", "Invalid message id");
    return;
  }

  const recipientUserIds = parseRecipientIds((req.body ?? {}).recipientUserIds);
  if (!recipientUserIds) {
    sendApiError(res, 400, "validation.invalid_body", "recipientUserIds must be an array of user ids");
    return;
  }

  const ticketId = parseOptionalTicketId((req.body ?? {}).ticketId);
  const pagePath =
    typeof (req.body ?? {}).pagePath === "string"
      ? (req.body as { pagePath: string }).pagePath.trim().slice(0, 512)
      : null;
  const message =
    typeof (req.body ?? {}).message === "string"
      ? (req.body as { message: string }).message.trim().slice(0, 500)
      : null;

  const shareContext = await loadAssistantShareContext(messageId, session.userId);
  if (!shareContext) {
    sendApiError(res, 404, "assistant.message_not_found", "Assistant message not found");
    return;
  }

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const actor = toActor(session, fieldEmployee);

  const result = await sendAskVShare({
    ticketId,
    actor,
    recipientUserIds,
    message,
    sourceTitle: shareContext.sourceTitle,
    sourceBody: shareContext.sourceBody,
    pagePath,
    messageId,
  });

  if (!result.ok) {
    const status =
      result.code === "send_to.forbidden" || result.code === "send_to.forbidden_recipient"
        ? 403
        : 400;
    sendApiError(res, status, result.code, result.message);
    return;
  }

  res.json({
    ok: true,
    notifiedCount: result.notifiedCount,
    trackingNumber: result.trackingNumber,
    ticketId,
  });
});

export default router;
