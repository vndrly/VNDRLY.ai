import { and, eq, gte, desc } from "drizzle-orm";
import {
  db,
  ticketsTable,
  ticketNudgesTable,
} from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import {
  findPartnerUserIds,
  findVendorUserIds,
  notifyUsers,
} from "../routes/notifications";
import {
  fieldEmployeeCanAccessTicket,
  loadFieldTicketAccessRow,
  ticketParticipantUserIdsExpanded,
} from "./field-ticket-access";

export type NudgeDirection = "up" | "down";
export type NudgeTier = "field" | "vendor_office" | "partner";

const TIER_ORDER: NudgeTier[] = ["field", "vendor_office", "partner"];

/** Minimum time between nudges from the same actor on the same ticket+direction. */
export const NUDGE_COOLDOWN_MS = 15 * 60 * 1000;

const BLOCKED_STATUSES = new Set([
  "cancelled",
  "denied",
  "completed",
  "funds_dispersed",
]);

export type NudgeActorTier = NudgeTier | "admin";

export function resolveActorTier(input: {
  role: string;
}): NudgeActorTier | null {
  if (input.role === "admin") return "admin";
  if (input.role === "partner") return "partner";
  if (input.role === "vendor") return "vendor_office";
  if (input.role === "field_employee") return "field";
  return null;
}

export function resolveTargetTier(
  actorTier: NudgeActorTier,
  direction: NudgeDirection,
): NudgeTier | null {
  const effective: NudgeTier =
    actorTier === "admin" ? "vendor_office" : actorTier;
  const idx = TIER_ORDER.indexOf(effective);
  if (idx < 0) return null;
  if (direction === "up") {
    if (idx >= TIER_ORDER.length - 1) return null;
    return TIER_ORDER[idx + 1]!;
  }
  if (idx <= 0) return null;
  return TIER_ORDER[idx - 1]!;
}

export function nudgeTitleFor(
  direction: NudgeDirection,
  targetTier: NudgeTier,
  tracking: string,
): string {
  if (direction === "up") {
    if (targetTier === "vendor_office") {
      return `Waiting on office review — ${tracking}`;
    }
    if (targetTier === "partner") {
      return `Waiting on partner approval — ${tracking}`;
    }
  }
  if (targetTier === "field") {
    return `Waiting on field crew — ${tracking}`;
  }
  if (targetTier === "vendor_office") {
    return `Waiting on vendor office — ${tracking}`;
  }
  return `Workflow nudge — ${tracking}`;
}

export async function resolveNudgeRecipientUserIds(
  ticketId: number,
  targetTier: NudgeTier,
  ticket: NonNullable<Awaited<ReturnType<typeof loadFieldTicketAccessRow>>>,
): Promise<number[]> {
  if (targetTier === "field") {
    const expanded = await ticketParticipantUserIdsExpanded(ticketId);
    return expanded.ids;
  }
  if (targetTier === "vendor_office" && ticket.vendorId) {
    return findVendorUserIds(ticket.vendorId);
  }
  if (targetTier === "partner" && ticket.partnerId) {
    return findPartnerUserIds(ticket.partnerId);
  }
  return [];
}

export async function assertNudgeRateLimit(
  ticketId: number,
  actorUserId: number,
  direction: NudgeDirection,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - NUDGE_COOLDOWN_MS);
  const rows = await db
    .select({ createdAt: ticketNudgesTable.createdAt })
    .from(ticketNudgesTable)
    .where(
      and(
        eq(ticketNudgesTable.ticketId, ticketId),
        eq(ticketNudgesTable.actorUserId, actorUserId),
        eq(ticketNudgesTable.direction, direction),
        gte(ticketNudgesTable.createdAt, since),
      ),
    )
    .limit(1);

  const recent = rows[0];
  if (!recent) return { ok: true };
  const elapsed = Date.now() - new Date(recent.createdAt).getTime();
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((NUDGE_COOLDOWN_MS - elapsed) / 1000),
  );
  return { ok: false, retryAfterSeconds };
}

export async function actorCanNudgeTicket(input: {
  role: string;
  userId: number;
  vendorId: number | null;
  partnerId: number | null;
  ticketId: number;
  ticket: NonNullable<Awaited<ReturnType<typeof loadFieldTicketAccessRow>>>;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
}): Promise<boolean> {
  if (input.role === "admin") return true;
  if (input.role === "vendor") {
    return input.vendorId != null && input.vendorId === input.ticket.vendorId;
  }
  if (input.role === "partner") {
    return (
      input.partnerId != null && input.partnerId === input.ticket.partnerId
    );
  }
  if (input.role === "field_employee" && input.fieldEmployee) {
    return fieldEmployeeCanAccessTicket(
      input.ticketId,
      input.fieldEmployee,
      input.ticket,
    );
  }
  return false;
}

export type SendTicketNudgeInput = {
  ticketId: number;
  actorUserId: number;
  actorRole: string;
  actorDisplayName?: string | null;
  actorVendorId: number | null;
  actorPartnerId: number | null;
  direction: NudgeDirection;
  message?: string | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
};

export type SendTicketNudgeResult =
  | {
      ok: true;
      nudgeId: number;
      targetTier: NudgeTier;
      notifiedCount: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryAfterSeconds?: number;
    };

export async function sendTicketNudge(
  input: SendTicketNudgeInput,
): Promise<SendTicketNudgeResult> {
  const ticket = await loadFieldTicketAccessRow(input.ticketId);
  if (!ticket?.vendorId) {
    return {
      ok: false,
      code: "ticket.not_found",
      message: "Ticket not found",
    };
  }

  const [meta] = await db
    .select({ status: ticketsTable.status })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, input.ticketId));
  if (!meta) {
    return {
      ok: false,
      code: "ticket.not_found",
      message: "Ticket not found",
    };
  }

  if (BLOCKED_STATUSES.has(meta.status)) {
    return {
      ok: false,
      code: "nudge.ticket_closed",
      message: "Cannot nudge a closed or terminal ticket",
    };
  }

  const actorTier = resolveActorTier({ role: input.actorRole });
  if (!actorTier) {
    return {
      ok: false,
      code: "nudge.not_allowed",
      message: "Your role cannot send workflow nudges",
    };
  }

  const allowed = await actorCanNudgeTicket({
    role: input.actorRole,
    userId: input.actorUserId,
    vendorId: input.actorVendorId,
    partnerId: input.actorPartnerId,
    ticketId: input.ticketId,
    ticket,
    fieldEmployee: input.fieldEmployee ?? null,
  });
  if (!allowed) {
    return {
      ok: false,
      code: "ticket.no_access",
      message: "You do not have access to this ticket",
    };
  }

  const targetTier = resolveTargetTier(actorTier, input.direction);
  if (!targetTier) {
    return {
      ok: false,
      code: "nudge.invalid_direction",
      message:
        input.direction === "up"
          ? "There is no party above you to nudge on this ticket"
          : "There is no party below you to nudge on this ticket",
    };
  }

  const rate = await assertNudgeRateLimit(
    input.ticketId,
    input.actorUserId,
    input.direction,
  );
  if (!rate.ok) {
    return {
      ok: false,
      code: "nudge.rate_limited",
      message: "Please wait before sending another nudge in this direction",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  const recipients = await resolveNudgeRecipientUserIds(
    input.ticketId,
    targetTier,
    ticket,
  );
  const filtered = recipients.filter((uid) => uid !== input.actorUserId);
  if (filtered.length === 0) {
    return {
      ok: false,
      code: "nudge.no_recipients",
      message: "No users are available to receive this nudge",
    };
  }

  const tracking = formatTicketTrackingNumber(input.ticketId);
  const actorName = input.actorDisplayName?.trim() || "Someone";
  const title = nudgeTitleFor(input.direction, targetTier, tracking);
  const note = input.message?.trim();
  const body = note
    ? `${actorName} is waiting on a response: ${note}`
    : `${actorName} is waiting on a response on ${tracking}.`;

  const [row] = await db
    .insert(ticketNudgesTable)
    .values({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      direction: input.direction,
      targetTier,
      message: note || null,
      ticketStatus: meta.status,
    })
    .returning({ id: ticketNudgesTable.id });

  const dedupeKey = `workflow_nudge:${row!.id}`;
  const notifiedCount = await notifyUsers(filtered, {
    type: "workflow_nudge",
    title,
    body,
    link: `/tickets/${input.ticketId}`,
    dedupeKey,
    category: "tickets",
    pushData: {
      ticketId: input.ticketId,
      type: "workflow_nudge",
      direction: input.direction,
      targetTier,
    },
  });

  return {
    ok: true,
    nudgeId: row!.id,
    targetTier,
    notifiedCount,
  };
}

export async function listTicketNudges(
  ticketId: number,
  limit = 20,
): Promise<
  {
    id: number;
    direction: string;
    targetTier: string;
    message: string | null;
    ticketStatus: string;
    createdAt: Date;
    actorUserId: number;
  }[]
> {
  return db
    .select({
      id: ticketNudgesTable.id,
      direction: ticketNudgesTable.direction,
      targetTier: ticketNudgesTable.targetTier,
      message: ticketNudgesTable.message,
      ticketStatus: ticketNudgesTable.ticketStatus,
      createdAt: ticketNudgesTable.createdAt,
      actorUserId: ticketNudgesTable.actorUserId,
    })
    .from(ticketNudgesTable)
    .where(eq(ticketNudgesTable.ticketId, ticketId))
    .orderBy(desc(ticketNudgesTable.createdAt))
    .limit(limit);
}
