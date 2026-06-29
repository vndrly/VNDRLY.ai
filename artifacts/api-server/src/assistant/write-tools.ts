// Bounded write tools for askV — small, explicit mutations the user could
// perform themselves in the UI. Each tool re-checks session scope server-side
// and refuses token/signup modes upstream in routes/assistant.ts#runTool.

import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, notificationsTable, ticketsTable, vendorPeopleTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { SESSION_SECRET } from "../lib/session";
import { handleScheduleTicketRequest } from "../routes/ticketSchedule";

function err(message: string): string {
  return JSON.stringify({ error: message });
}

export const WRITE_TOOL_NAMES = ["mark_notifications_read", "schedule_ticket_crew"] as const;
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
  }
}
