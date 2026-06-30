// Bounded write tools for askV — small, explicit mutations the user could
// perform themselves in the UI. Each tool re-checks session scope server-side
// and refuses token/signup modes upstream in routes/assistant.ts#runTool.

import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, notificationsTable, ticketNoteLogsTable, ticketsTable, vendorPeopleTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { SESSION_SECRET } from "../lib/session";
import { handleScheduleTicketRequest } from "../routes/ticketSchedule";
import { clearTicketFlag, flagTicket } from "../lib/ticket-flag";
import {
  fieldEmployeeCanAccessTicket,
  loadFieldTicketAccessRow,
  ticketParticipantUserIdsExpanded,
} from "../lib/field-ticket-access";
import { findPartnerUserIds, findVendorUserIds, notifyUsers } from "../routes/notifications";

function err(message: string): string {
  return JSON.stringify({ error: message });
}

export const WRITE_TOOL_NAMES = [
  "mark_notifications_read",
  "schedule_ticket_crew",
  "set_ticket_flag",
  "post_ticket_comment",
] as const;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

interface MarkNotificationsReadInput {
  notificationId?: number;
  /** When true (default), mark every unread notification for this user. */
  markAll?: boolean;
}

interface ScheduleTicketCrewInput {
  ticketId?: number;
  crewEmployeeId?: number;
  crewMemberName?: string;
  scheduledStartAt?: string;
  scheduledDurationMinutes?: number | null;
  warningKinds?: string[];
  force?: boolean;
  confirmed?: boolean;
}

interface SetTicketFlagInput {
  ticketId?: number;
  flagged?: boolean;
  reason?: string | null;
  confirmed?: boolean;
}

interface PostTicketCommentInput {
  ticketId?: number;
  content?: string;
  confirmed?: boolean;
}

function internalSessionCookie(session: SessionPayload): string {
  const payload = {
    ...session,
    exp: Math.floor(Date.now() / 1000) + 60,
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encoded)
    .digest("hex");
  return `${encoded}.${sig}`;
}

function makeCaptureRes() {
  let statusCode = 200;
  let body: unknown = undefined;
  return {
    res: {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    },
    result() {
      return { statusCode, body };
    },
  };
}

async function resolveCrewEmployee(input: ScheduleTicketCrewInput, vendorId: number) {
  if (typeof input.crewEmployeeId === "number" && Number.isFinite(input.crewEmployeeId)) {
    const id = Math.floor(input.crewEmployeeId);
    const [employee] = await db
      .select({
        id: vendorPeopleTable.id,
        firstName: vendorPeopleTable.firstName,
        lastName: vendorPeopleTable.lastName,
        email: vendorPeopleTable.email,
      })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.id, id),
          eq(vendorPeopleTable.vendorId, vendorId),
          eq(vendorPeopleTable.isActive, true),
          isNull(vendorPeopleTable.deletedAt),
        ),
      )
      .limit(1);
    return employee ? { employee, matches: [employee] } : { employee: null, matches: [] };
  }

  const rawName = typeof input.crewMemberName === "string" ? input.crewMemberName.trim() : "";
  if (!rawName) return { employee: null, matches: [] };
  const needle = `%${rawName.toLowerCase()}%`;
  const matches = await db
    .select({
      id: vendorPeopleTable.id,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      email: vendorPeopleTable.email,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
        sql`(
          LOWER(TRIM(COALESCE(${vendorPeopleTable.firstName}, '') || ' ' || COALESCE(${vendorPeopleTable.lastName}, ''))) LIKE ${needle}
          OR LOWER(${vendorPeopleTable.email}) LIKE ${needle}
        )`,
      ),
    )
    .limit(5);
  return { employee: matches.length === 1 ? matches[0] : null, matches };
}

async function scheduleTicketCrew(
  input: ScheduleTicketCrewInput,
  session: SessionPayload,
): Promise<string> {
  if (!session.userId || !session.role) {
    return err("Must be signed in to schedule ticket crew.");
  }
  if (input.confirmed !== true) {
    return err("AskV needs explicit confirmation before scheduling a crew member.");
  }

  const ticketId = Number(input.ticketId);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return err("Provide a valid ticketId.");
  }
  const scheduledStartAt = input.scheduledStartAt ? new Date(input.scheduledStartAt) : null;
  if (!scheduledStartAt || Number.isNaN(scheduledStartAt.getTime())) {
    return err("Provide scheduledStartAt as an exact ISO timestamp.");
  }
  const scheduledDurationMinutes =
    input.scheduledDurationMinutes == null
      ? null
      : Number(input.scheduledDurationMinutes);
  if (
    scheduledDurationMinutes != null &&
    (!Number.isFinite(scheduledDurationMinutes) || scheduledDurationMinutes < 0)
  ) {
    return err("scheduledDurationMinutes must be a non-negative number.");
  }

  const [ticket] = await db
    .select({ id: ticketsTable.id, vendorId: ticketsTable.vendorId })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, Math.floor(ticketId)))
    .limit(1);
  if (!ticket) return err(`Ticket ${Math.floor(ticketId)} was not found.`);

  const { employee, matches } = await resolveCrewEmployee(input, ticket.vendorId);
  if (!employee) {
    if (matches.length > 1) {
      return JSON.stringify({
        error: "Multiple crew members matched. Ask the user which one to schedule.",
        matches: matches.map((m) => ({
          crewEmployeeId: m.id,
          name: `${m.firstName} ${m.lastName}`.trim(),
          email: m.email,
        })),
      });
    }
    return err("Crew member was not found on this ticket vendor's active roster.");
  }

  const capture = makeCaptureRes();
  await handleScheduleTicketRequest(
    {
      params: { id: String(Math.floor(ticketId)) },
      body: {
        scheduledStartAt: scheduledStartAt.toISOString(),
        scheduledDurationMinutes,
        crewEmployeeIds: [employee.id],
        warningKinds: Array.isArray(input.warningKinds) ? input.warningKinds : ["1d", "12h", "1h"],
        force: input.force === true,
      },
      cookies: { vndrly_session: internalSessionCookie(session) },
      headers: { "user-agent": "askv-write-tool" },
      ip: null,
    },
    capture.res,
  );

  const result = capture.result();
  if (result.statusCode >= 400) {
    return JSON.stringify({
      error: "Schedule request failed.",
      statusCode: result.statusCode,
      details: result.body,
    });
  }
  return JSON.stringify({
    ...(typeof result.body === "object" && result.body !== null ? result.body : { result: result.body }),
    scheduledCrew: {
      crewEmployeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      email: employee.email,
    },
  });
}

async function markNotificationsRead(
  input: MarkNotificationsReadInput,
  session: SessionPayload,
): Promise<string> {
  if (!session.userId) {
    return err("Must be signed in to update notifications.");
  }
  const userId = session.userId;

  if (typeof input.notificationId === "number" && Number.isFinite(input.notificationId)) {
    const id = Math.floor(input.notificationId);
    const updated = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
      .returning({ id: notificationsTable.id });
    if (updated.length === 0) {
      return err(`Notification ${id} was not found on your account.`);
    }
    return JSON.stringify({ ok: true, marked: 1, notificationId: id });
  }

  const markAll = input.markAll !== false;
  if (!markAll) {
    return err("Provide notificationId or set markAll to true.");
  }

  const updated = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)))
    .returning({ id: notificationsTable.id });
  return JSON.stringify({ ok: true, marked: updated.length, markAll: true });
}

async function getFieldEmployeeForSession(session: SessionPayload) {
  if (session.role !== "field_employee" || !session.userId) return null;
  const [employee] = await db
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
    )
    .limit(1);
  if (!employee?.userId) return null;
  return { ...employee, userId: employee.userId };
}

async function setTicketFlag(input: SetTicketFlagInput, session: SessionPayload): Promise<string> {
  if (!session.userId || !session.role) {
    return err("Must be signed in to flag or unflag a ticket.");
  }
  if (input.confirmed !== true) {
    return err("AskV needs explicit confirmation before flagging or unflagging a ticket.");
  }

  const ticketId = Number(input.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return err("Provide a valid ticketId.");
  }
  if (typeof input.flagged !== "boolean") {
    return err("Set flagged to true or false.");
  }

  const fieldEmployee = await getFieldEmployeeForSession(session);
  const actor = {
    ticketId,
    actorUserId: session.userId,
    actorRole: session.role,
    actorVendorId: session.vendorId ?? null,
    actorPartnerId: session.partnerId ?? null,
    fieldEmployee,
  };

  if (input.flagged) {
    const result = await flagTicket({
      ...actor,
      actorDisplayName: session.displayName,
      reason: typeof input.reason === "string" ? input.reason : null,
    });
    if (!result.ok) {
      return JSON.stringify({ error: result.message, code: result.code });
    }
    return JSON.stringify({
      ok: true,
      ticketId,
      flagged: true,
      flagId: result.flagId,
      notifiedCount: result.notifiedCount,
    });
  }

  const result = await clearTicketFlag(actor);
  if (!result.ok) {
    return JSON.stringify({ error: result.message, code: result.code });
  }
  return JSON.stringify({
    ok: true,
    ticketId,
    flagged: false,
  });
}

async function canParticipateInTicketThread(
  ticketId: number,
  session: SessionPayload,
  fieldEmployee: { id: number; vendorId: number; userId: number } | null,
) {
  const ticket = await loadFieldTicketAccessRow(ticketId);
  if (!ticket) return { allowed: false, ticket: null };
  if (session.role === "admin") return { allowed: true, ticket };
  if (session.role === "vendor" && session.vendorId != null && session.vendorId === ticket.vendorId) {
    return { allowed: true, ticket };
  }
  if (session.role === "partner" && session.partnerId != null && session.partnerId === ticket.partnerId) {
    return { allowed: true, ticket };
  }
  if (session.role === "field_employee" && fieldEmployee) {
    return { allowed: await fieldEmployeeCanAccessTicket(ticketId, fieldEmployee, ticket), ticket };
  }
  return { allowed: false, ticket };
}

async function postTicketComment(input: PostTicketCommentInput, session: SessionPayload): Promise<string> {
  if (!session.userId || !session.role) {
    return err("Must be signed in to post a ticket comment.");
  }
  if (input.confirmed !== true) {
    return err("AskV needs explicit confirmation before posting a ticket comment.");
  }

  const ticketId = Number(input.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return err("Provide a valid ticketId.");
  }
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    return err("Provide comment content.");
  }

  const fieldEmployee = await getFieldEmployeeForSession(session);
  const access = await canParticipateInTicketThread(ticketId, session, fieldEmployee);
  if (!access.ticket) return err(`Ticket ${ticketId} was not found.`);
  if (!access.allowed) return err("You do not have access to comment on that ticket.");

  const [comment] = await db
    .insert(ticketNoteLogsTable)
    .values({
      ticketId,
      content,
      createdById: session.userId,
    })
    .returning({
      id: ticketNoteLogsTable.id,
      ticketId: ticketNoteLogsTable.ticketId,
      content: ticketNoteLogsTable.content,
      createdAt: ticketNoteLogsTable.createdAt,
    });

  const participants = await ticketParticipantUserIdsExpanded(ticketId);
  const notifyIds = new Set<number>(participants.ids);
  if (participants.vendorId) {
    for (const id of await findVendorUserIds(participants.vendorId)) notifyIds.add(id);
  }
  if (participants.partnerId) {
    for (const id of await findPartnerUserIds(participants.partnerId)) notifyIds.add(id);
  }
  notifyIds.delete(session.userId);

  const notifiedCount = notifyIds.size
    ? await notifyUsers([...notifyIds], {
        type: "comment_added",
        title: `${session.displayName || "Someone"} commented on tracking #${String(ticketId).padStart(4, "0")}`,
        body: content.slice(0, 120),
        link: `/tickets/${ticketId}#comment-${comment!.id}`,
        dedupeKey: `comment_added:${comment!.id}`,
      })
    : 0;

  return JSON.stringify({
    ok: true,
    ticketId,
    commentId: comment!.id,
    createdAt: comment!.createdAt.toISOString(),
    notifiedCount,
  });
}

export async function runWriteTool(
  name: WriteToolName,
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "mark_notifications_read":
      return markNotificationsRead(args as MarkNotificationsReadInput, session);
    case "schedule_ticket_crew":
      return scheduleTicketCrew(args as ScheduleTicketCrewInput, session);
    case "set_ticket_flag":
      return setTicketFlag(args as SetTicketFlagInput, session);
    case "post_ticket_comment":
      return postTicketComment(args as PostTicketCommentInput, session);
  }
}
