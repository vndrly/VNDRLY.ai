import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
export class LiveTicketAssignmentError extends Error {
  constructor(
    public code: string,
    public status = 403,
  ) {
    super(code);
  }
}
export async function requireLiveTicketAssignment(
  c: PoolClient,
  s: SessionPayload,
  ticketId: number,
) {
  if (!s.userId || !s.vendorId)
    throw new LiveTicketAssignmentError("native.worker_company_required", 403);
  const tickets = await c.query(
    "SELECT vendor_id,field_employee_id,foreman_user_id,acting_foreman_user_id FROM tickets WHERE id=$1 FOR UPDATE",
    [ticketId],
  );
  const ticket = tickets.rows[0];
  if (!ticket || ticket.vendor_id !== s.vendorId)
    throw new LiveTicketAssignmentError("native.ticket_scope_required", 403);
  const people = await c.query(
    "SELECT id FROM vendor_people WHERE user_id=$1 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL FOR SHARE",
    [s.userId, s.vendorId],
  );
  const personIds = people.rows.map((row) => row.id);
  const crew = await c.query(
    "SELECT id FROM ticket_crew WHERE ticket_id=$1 AND employee_id=ANY($2::integer[]) AND removed_at IS NULL FOR SHARE",
    [ticketId, personIds],
  );
  if (
    ticket.foreman_user_id !== s.userId &&
    ticket.acting_foreman_user_id !== s.userId &&
    !personIds.includes(ticket.field_employee_id) &&
    !crew.rows.length
  )
    throw new LiveTicketAssignmentError("native.ticket_scope_required", 403);
}
