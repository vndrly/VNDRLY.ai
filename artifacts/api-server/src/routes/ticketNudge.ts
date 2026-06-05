import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import crypto from "crypto";
import { db, vendorPeopleTable } from "@workspace/db";
import { SESSION_SECRET } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import {
  actorCanNudgeTicket,
  listTicketNudges,
  sendTicketNudge,
  type NudgeDirection,
} from "../lib/ticket-nudge";
import { loadFieldTicketAccessRow } from "../lib/field-ticket-access";

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
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
    ) {
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
        isNull(vendorPeopleTable.deletedAt),
      ),
    );
  if (!fe?.userId) return null;
  return { ...fe, userId: fe.userId };
}

function parseDirection(raw: unknown): NudgeDirection | null {
  if (raw === "up" || raw === "down") return raw;
  return null;
}

const router: IRouter = Router();

/** POST /api/tickets/:id/nudge — remind the next party up/down the workflow chain. */
router.post("/tickets/:id/nudge", async (req: Request, res: Response): Promise<void> => {
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

  const direction = parseDirection((req.body ?? {}).direction);
  if (!direction) {
    sendApiError(
      res,
      400,
      "nudge.invalid_direction",
      "direction must be 'up' or 'down'",
    );
    return;
  }

  const message =
    typeof (req.body ?? {}).message === "string"
      ? (req.body as { message: string }).message.trim().slice(0, 500)
      : null;

  const fieldEmployee = await getFieldEmployeeForSession(req);

  const result = await sendTicketNudge({
    ticketId,
    actorUserId: session.userId,
    actorRole: session.role,
    actorDisplayName: session.displayName,
    actorVendorId: session.vendorId,
    actorPartnerId: session.partnerId,
    direction,
    message: message || null,
    fieldEmployee,
  });

  if (!result.ok) {
    const status =
      result.code === "nudge.rate_limited"
        ? 429
        : result.code === "ticket.no_access"
          ? 403
          : result.code === "ticket.not_found"
            ? 404
            : 400;
    if (result.retryAfterSeconds != null) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
    }
    sendApiError(res, status, result.code, result.message);
    return;
  }

  res.status(201).json({
    id: result.nudgeId,
    ticketId,
    direction,
    targetTier: result.targetTier,
    notifiedCount: result.notifiedCount,
  });
});

/** GET /api/tickets/:id/nudges — recent workflow nudges (audit trail). */
router.get("/tickets/:id/nudges", async (req: Request, res: Response): Promise<void> => {
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

  const ticket = await loadFieldTicketAccessRow(ticketId);
  if (!ticket) {
    sendApiError(res, 404, "ticket.not_found", "Ticket not found");
    return;
  }

  const fieldEmployee = await getFieldEmployeeForSession(req);
  const allowed = await actorCanNudgeTicket({
    role: session.role,
    userId: session.userId,
    vendorId: session.vendorId,
    partnerId: session.partnerId,
    ticketId,
    ticket,
    fieldEmployee,
  });
  if (!allowed) {
    sendApiError(res, 403, "ticket.no_access", "Forbidden");
    return;
  }

  const rows = await listTicketNudges(ticketId);
  res.json(rows);
});

export default router;
