import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { db, notificationsTable, vendorPeopleTable } from "@workspace/db";
import { parseTicketIdFromHref } from "../lib/parse-ticket-href";
import { sendApiError } from "../lib/apiError";
import { SESSION_SECRET } from "../lib/session";
import {
  actorCanSendToTicket,
  listSendToRecipients,
  sendTicketForward,
  type SendToActor,
} from "../lib/ticket-send-to";

const COOKIE_NAME = "vndrly_session";

type Session = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  displayName?: string;
};

function getSession(req: Request): Session | null {
  const cookie = (req as any).cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
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

  const groups = await listSendToRecipients(ticketId, actor);
  res.json({ groups });
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

  const ticketId = parseTicketIdFromHref(row.link ?? "");
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

  const groups = await listSendToRecipients(ticketId, actor);
  res.json({ ticketId, groups });
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

  const ticketId = parseTicketIdFromHref(row.link ?? "");
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

export default router;
