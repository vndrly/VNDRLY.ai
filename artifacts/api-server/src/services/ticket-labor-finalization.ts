import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { TicketLaborFinalizationInputSchema, TicketLaborFinalizationReceiptSchema, type TicketLaborFinalizationReceipt } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { canReadTicket } from "../lib/field-ticket-access";
import { regenerateAutoLaborLines } from "../lib/auto-labor-lines";

export class TicketLaborFinalizationError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export const FINALIZATION_REFUSE_STATUSES = new Set(["awaiting_acceptance", "denied", "cancelled", "approved", "completed", "funds_dispersed", "submitted"]);
type Ticket = { id: number; vendor_id: number | null; status: string; closed_at: Date | null; closed_by_id?: number | null; updated_at: Date };
type Authority = (client: PoolClient, session: SessionPayload, ticket: Ticket) => Promise<void>;

/** Same current vendor/admin/foreman actor set as close; roster visibility alone never grants finalization. */
export const authorizeTicketLaborFinalization: Authority = async (client, session, ticket) => {
  await client.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [session.userId]);
  if (session.activeMembershipId) await client.query("SELECT id FROM user_org_memberships WHERE id=$1 AND user_id=$2 FOR SHARE", [session.activeMembershipId, session.userId]);
  const database = drizzle(client, { schema });
  try { await validateAssistantSession(session, database); } catch { throw new TicketLaborFinalizationError("ticket.no_access", 403); }
  if (!await canReadTicket(session, ticket.id, database)) throw new TicketLaborFinalizationError("ticket.no_access", 403);
  if (session.role === "admin") return;
  if (session.role === "vendor" && session.vendorId === ticket.vendor_id) return;
  if (session.role === "field_employee" && session.vendorId === ticket.vendor_id) {
    const people = await client.query("SELECT id FROM vendor_people WHERE id=$1 AND user_id=$2 AND vendor_id=$3 AND is_active=true AND deleted_at IS NULL AND vendor_role IN ('foreman','both') FOR SHARE", [session.vendorPeopleId, session.userId, ticket.vendor_id]);
    if (people.rows.length) {
      // A current crew removal cannot race the fresh field-ticket predicate above.
      await client.query("SELECT employee_id FROM ticket_crew WHERE ticket_id=$1 AND employee_id=$2 AND removed_at IS NULL FOR SHARE", [ticket.id, session.vendorPeopleId]);
      if (await canReadTicket(session, ticket.id, database)) return;
    }
  }
  throw new TicketLaborFinalizationError("ticket.no_access", 403);
};

export function createTicketLaborFinalizationService(database: Pick<Pool, "connect"> = pool, authorize: Authority = authorizeTicketLaborFinalization, regenerate = async (client: PoolClient, ticketId: number) => regenerateAutoLaborLines(ticketId, drizzle(client, { schema }))) {
  async function run(session: SessionPayload, ticketId: number, input: unknown, mode: "apply" | "read" | "capability") {
    if (!session?.userId || !Number.isSafeInteger(ticketId) || ticketId < 1) throw new TicketLaborFinalizationError("ticket.no_access", 403);
    const command = mode === "apply" ? TicketLaborFinalizationInputSchema.parse(input) : null;
    const operationId = command?.operationId ?? (mode === "read" ? TicketLaborFinalizationInputSchema.shape.operationId.parse(input) : null);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      if (operationId) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["ticket-labor-finalization:" + operationId]);
      const found = await client.query<Ticket>("SELECT id,vendor_id,status,closed_at,closed_by_id,updated_at FROM tickets WHERE id=$1 FOR UPDATE", [ticketId]);
      const ticket = found.rows[0];
      if (!ticket) throw new TicketLaborFinalizationError("ticket.not_found", 404);
      await authorize(client, session, ticket);
      if (mode === "capability") { await client.query("COMMIT"); return !ticket.closed_at && !FINALIZATION_REFUSE_STATUSES.has(ticket.status); }
      const prior = await client.query("SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='ticket-labor-finalization' AND target_id=$1 ORDER BY id", [operationId]);
      if (prior.rows.length > 1) throw new TicketLaborFinalizationError("ticket.state_changed");
      if (prior.rows[0]) {
        const saved = TicketLaborFinalizationReceiptSchema.safeParse(prior.rows[0].tool_output);
        if (!saved.success || prior.rows[0].user_id !== session.userId || saved.data.actorUserId !== session.userId || saved.data.ticketId !== ticketId || saved.data.operationId !== operationId || (command && saved.data.expectedUpdatedAt !== command.expectedUpdatedAt)) throw new TicketLaborFinalizationError("ticket.state_changed");
        const fingerprint = createHash("sha256").update(JSON.stringify([session.userId, ticketId, operationId, saved.data.expectedUpdatedAt])).digest("hex");
        if (prior.rows[0].tool_input?.fingerprint !== fingerprint || !ticket.closed_at || ticket.closed_at.toISOString() !== saved.data.closedAt || ticket.closed_by_id !== saved.data.closedById) throw new TicketLaborFinalizationError("ticket.state_changed");
        await client.query("COMMIT"); return saved.data;
      }
      if (mode === "read") { await client.query("COMMIT"); return null; }
      if (!command) throw new TicketLaborFinalizationError("ticket.state_changed");
      if (ticket.closed_at || FINALIZATION_REFUSE_STATUSES.has(ticket.status)) throw new TicketLaborFinalizationError("ticket.not_closeable");
      if (ticket.updated_at.toISOString() !== command.expectedUpdatedAt) throw new TicketLaborFinalizationError("ticket.state_changed");
      const autoLaborLineCount = await regenerate(client, ticketId);
      const acceptedAt = new Date();
      const updatedAt = new Date(Math.max(acceptedAt.getTime(), ticket.updated_at.getTime() + 1));
      await client.query("UPDATE tickets SET closed_at=$2,closed_by_id=$3,updated_at=$4 WHERE id=$1", [ticketId, acceptedAt, session.userId, updatedAt]);
      const receipt: TicketLaborFinalizationReceipt = TicketLaborFinalizationReceiptSchema.parse({ ticketId, operationId, actorUserId: session.userId, expectedUpdatedAt: command.expectedUpdatedAt, updatedAt: updatedAt.toISOString(), closedAt: acceptedAt.toISOString(), closedById: session.userId, autoLaborLineCount, status: "applied", physicalWorkVerified: false, submitted: false });
      const fingerprint = createHash("sha256").update(JSON.stringify([session.userId, ticketId, operationId, command.expectedUpdatedAt])).digest("hex");
      await client.query("INSERT INTO assistant_action_audit(user_id,actor_role,partner_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'api','web_text','vndrly','finalize_ticket_labor','mutation','ticket-labor-finalization',$5,$6::jsonb,$7::jsonb,'success')", [session.userId, session.role, session.partnerId ?? null, session.vendorId ?? null, operationId, JSON.stringify({ ticketId, ...command, fingerprint }), JSON.stringify(receipt)]);
      await client.query("COMMIT"); return receipt;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return {
    apply: (session: SessionPayload, ticketId: number, input: unknown) => run(session, ticketId, input, "apply") as Promise<TicketLaborFinalizationReceipt>,
    read: (session: SessionPayload, ticketId: number, operationId: string) => run(session, ticketId, operationId, "read") as Promise<TicketLaborFinalizationReceipt | null>,
    canFinalize: async (session: SessionPayload | null, ticketId: number) => { if (!session) return false; try { return await run(session, ticketId, null, "capability") === true; } catch (error) { return false; } },
  };
}
