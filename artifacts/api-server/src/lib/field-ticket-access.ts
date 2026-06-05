import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  ticketCrewTable,
  ticketsTable,
  siteLocationsTable,
  vendorPeopleTable,
} from "@workspace/db";

export type FieldTicketAccessRow = {
  vendorId: number | null;
  fieldEmployeeId: number | null;
  foremanUserId: number | null;
  partnerId: number | null;
};

/** Load ticket tenancy fields used for field-employee access checks. */
export async function loadFieldTicketAccessRow(
  ticketId: number,
): Promise<FieldTicketAccessRow | null> {
  const [t] = await db
    .select({
      vendorId: ticketsTable.vendorId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      foremanUserId: ticketsTable.foremanUserId,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  return t ?? null;
}

/**
 * Whether a field employee (vendor_people row) may read/mutate a ticket
 * beyond crew-only routes — primary assignee, assigned foreman, or roster.
 */
export async function fieldEmployeeCanAccessTicket(
  ticketId: number,
  employee: { id: number; vendorId: number; userId: number },
  ticket: FieldTicketAccessRow,
): Promise<boolean> {
  if (ticket.vendorId !== employee.vendorId) return false;
  if (ticket.fieldEmployeeId === employee.id) return true;
  if (ticket.foremanUserId === employee.userId) return true;

  const [onCrew] = await db
    .select({ ticketId: ticketCrewTable.ticketId })
    .from(ticketCrewTable)
    .where(
      and(
        eq(ticketCrewTable.ticketId, ticketId),
        eq(ticketCrewTable.employeeId, employee.id),
        isNull(ticketCrewTable.removedAt),
      ),
    );
  return !!onCrew;
}

/** User ids for ticket thread participants (vendor, partner, primary, foreman, crew). */
export async function ticketParticipantUserIdsExpanded(ticketId: number): Promise<{
  ids: number[];
  vendorId: number | null;
  partnerId: number | null;
}> {
  const ticket = await loadFieldTicketAccessRow(ticketId);
  if (!ticket) return { ids: [], vendorId: null, partnerId: null };

  const ids = new Set<number>();

  if (ticket.foremanUserId) ids.add(ticket.foremanUserId);

  if (ticket.fieldEmployeeId) {
    const [fe] = await db
      .select({ userId: vendorPeopleTable.userId })
      .from(vendorPeopleTable)
      .where(eq(vendorPeopleTable.id, ticket.fieldEmployeeId));
    if (fe?.userId) ids.add(fe.userId);
  }

  const crew = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(ticketCrewTable)
    .innerJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(
      and(
        eq(ticketCrewTable.ticketId, ticketId),
        isNull(ticketCrewTable.removedAt),
      ),
    );
  for (const c of crew) {
    if (c.userId) ids.add(c.userId);
  }

  return {
    ids: [...ids],
    vendorId: ticket.vendorId,
    partnerId: ticket.partnerId,
  };
}
