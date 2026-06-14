import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  siteLocationsTable,
  ticketFlagsTable,
  ticketsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import {
  fieldEmployeeCanAccessTicket,
  loadFieldTicketAccessRow,
  ticketParticipantUserIdsExpanded,
} from "./field-ticket-access";
import { actorCanNudgeTicket } from "./ticket-nudge";
import {
  findPartnerUserIds,
  findVendorUserIds,
  notifyUsers,
} from "../routes/notifications";

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "denied",
  "completed",
  "funds_dispersed",
]);

export type TicketFlagSummary = {
  ticketId: number;
  trackingNumber: string;
  status: string;
  siteName: string | null;
  vendorName: string | null;
  reason: string | null;
  flaggedAt: string;
  flaggedByName: string | null;
};

export async function actorCanFlagTicket(input: {
  role: string;
  userId: number;
  vendorId: number | null;
  partnerId: number | null;
  ticketId: number;
  ticket: NonNullable<Awaited<ReturnType<typeof loadFieldTicketAccessRow>>>;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
}): Promise<boolean> {
  return actorCanNudgeTicket(input);
}

export async function getActiveTicketFlag(ticketId: number) {
  const [row] = await db
    .select({
      id: ticketFlagsTable.id,
      ticketId: ticketFlagsTable.ticketId,
      reason: ticketFlagsTable.reason,
      createdAt: ticketFlagsTable.createdAt,
      flaggedByUserId: ticketFlagsTable.flaggedByUserId,
      actorRole: ticketFlagsTable.actorRole,
    })
    .from(ticketFlagsTable)
    .where(
      and(eq(ticketFlagsTable.ticketId, ticketId), isNull(ticketFlagsTable.clearedAt)),
    )
    .orderBy(desc(ticketFlagsTable.createdAt))
    .limit(1);
  return row ?? null;
}

async function resolveFlagNotifyUserIds(ticketId: number): Promise<number[]> {
  const expanded = await ticketParticipantUserIdsExpanded(ticketId);
  const ids = new Set<number>(expanded.ids);
  if (expanded.vendorId) {
    for (const id of await findVendorUserIds(expanded.vendorId)) ids.add(id);
  }
  if (expanded.partnerId) {
    for (const id of await findPartnerUserIds(expanded.partnerId)) ids.add(id);
  }
  return [...ids];
}

export async function flagTicket(input: {
  ticketId: number;
  actorUserId: number;
  actorRole: string;
  actorDisplayName?: string | null;
  actorVendorId: number | null;
  actorPartnerId: number | null;
  reason?: string | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
}): Promise<
  | { ok: true; flagId: number; notifiedCount: number }
  | { ok: false; code: string; message: string }
> {
  const ticket = await loadFieldTicketAccessRow(input.ticketId);
  if (!ticket?.vendorId) {
    return { ok: false, code: "ticket.not_found", message: "Ticket not found" };
  }

  const [meta] = await db
    .select({ status: ticketsTable.status })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, input.ticketId));
  if (!meta) {
    return { ok: false, code: "ticket.not_found", message: "Ticket not found" };
  }
  if (TERMINAL_STATUSES.has(meta.status)) {
    return {
      ok: false,
      code: "flag.ticket_closed",
      message: "Cannot flag a closed or terminal ticket",
    };
  }

  const allowed = await actorCanFlagTicket({
    role: input.actorRole,
    userId: input.actorUserId,
    vendorId: input.actorVendorId,
    partnerId: input.actorPartnerId,
    ticketId: input.ticketId,
    ticket,
    fieldEmployee: input.fieldEmployee,
  });
  if (!allowed) {
    return { ok: false, code: "ticket.no_access", message: "Forbidden" };
  }

  const existing = await getActiveTicketFlag(input.ticketId);
  if (existing) {
    return {
      ok: false,
      code: "flag.already_flagged",
      message: "This ticket is already flagged",
    };
  }

  const [inserted] = await db
    .insert(ticketFlagsTable)
    .values({
      ticketId: input.ticketId,
      flaggedByUserId: input.actorUserId,
      actorRole: input.actorRole,
      reason: input.reason?.trim().slice(0, 500) || null,
    })
    .returning({ id: ticketFlagsTable.id });

  const tracking = formatTicketTrackingNumber(input.ticketId);
  const actorLabel = input.actorDisplayName?.trim() || "Someone";
  const notifyIds = await resolveFlagNotifyUserIds(input.ticketId);
  const filtered = notifyIds.filter((id) => id !== input.actorUserId);

  let notifiedCount = 0;
  if (filtered.length > 0) {
    notifiedCount = await notifyUsers(filtered, {
      type: "ticket_flagged",
      title: `Ticket flagged — ${tracking}`,
      body: input.reason?.trim()
        ? `${actorLabel} flagged ${tracking}: ${input.reason.trim()}`
        : `${actorLabel} flagged ${tracking} for attention.`,
      link: `/tickets/${input.ticketId}`,
      dedupeKey: `ticket_flagged:${input.ticketId}`,
      pushData: { ticketId: input.ticketId, type: "ticket_flagged" },
    });
  }

  return { ok: true, flagId: inserted!.id, notifiedCount };
}

export async function clearTicketFlag(input: {
  ticketId: number;
  actorUserId: number;
  actorRole: string;
  actorVendorId: number | null;
  actorPartnerId: number | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const ticket = await loadFieldTicketAccessRow(input.ticketId);
  if (!ticket?.vendorId) {
    return { ok: false, code: "ticket.not_found", message: "Ticket not found" };
  }

  const allowed = await actorCanFlagTicket({
    role: input.actorRole,
    userId: input.actorUserId,
    vendorId: input.actorVendorId,
    partnerId: input.actorPartnerId,
    ticketId: input.ticketId,
    ticket,
    fieldEmployee: input.fieldEmployee,
  });
  if (!allowed) {
    return { ok: false, code: "ticket.no_access", message: "Forbidden" };
  }

  const active = await getActiveTicketFlag(input.ticketId);
  if (!active) {
    return { ok: false, code: "flag.not_flagged", message: "Ticket is not flagged" };
  }

  await db
    .update(ticketFlagsTable)
    .set({
      clearedAt: new Date(),
      clearedByUserId: input.actorUserId,
    })
    .where(eq(ticketFlagsTable.id, active.id));

  return { ok: true };
}

export async function listFlaggedTicketsForViewer(input: {
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
  limit?: number;
}): Promise<TicketFlagSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const rows = await db
    .select({
      ticketId: ticketsTable.id,
      status: ticketsTable.status,
      vendorId: ticketsTable.vendorId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      siteName: siteLocationsTable.name,
      vendorName: vendorsTable.name,
      reason: ticketFlagsTable.reason,
      flaggedAt: ticketFlagsTable.createdAt,
      flaggedByName: usersTable.displayName,
    })
    .from(ticketFlagsTable)
    .innerJoin(ticketsTable, eq(ticketFlagsTable.ticketId, ticketsTable.id))
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(ticketFlagsTable.flaggedByUserId, usersTable.id))
    .where(isNull(ticketFlagsTable.clearedAt))
    .orderBy(desc(ticketFlagsTable.createdAt))
    .limit(limit);

  const filtered: typeof rows = [];
  for (const row of rows) {
    if (input.role === "admin") {
      filtered.push(row);
      continue;
    }
    if (input.role === "vendor" && input.vendorId != null && row.vendorId === input.vendorId) {
      filtered.push(row);
      continue;
    }
    if (input.role === "partner" && input.partnerId != null) {
      const ticket = await loadFieldTicketAccessRow(row.ticketId);
      if (ticket?.partnerId === input.partnerId) filtered.push(row);
      continue;
    }
    if (input.role === "field_employee" && input.fieldEmployee) {
      const ticket = await loadFieldTicketAccessRow(row.ticketId);
      if (
        ticket &&
        (await fieldEmployeeCanAccessTicket(row.ticketId, input.fieldEmployee, ticket))
      ) {
        filtered.push(row);
      }
    }
  }

  return filtered.map((row) => ({
    ticketId: row.ticketId,
    trackingNumber: formatTicketTrackingNumber(row.ticketId),
    status: row.status,
    siteName: row.siteName,
    vendorName: row.vendorName,
    reason: row.reason,
    flaggedAt: row.flaggedAt.toISOString(),
    flaggedByName: row.flaggedByName,
  }));
}

export async function countFlaggedTicketsForViewer(input: {
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
}): Promise<number> {
  const rows = await listFlaggedTicketsForViewer({ ...input, limit: 200 });
  return rows.length;
}
