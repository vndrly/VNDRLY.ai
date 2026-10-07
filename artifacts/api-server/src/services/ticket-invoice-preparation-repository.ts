import { and, eq, inArray, sql } from "drizzle-orm";
import { db, ticketsTable, invoiceTicketLinksTable, workHubClientOperationsTable, workHubAuditLogTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { generateInvoiceForTicket } from "../lib/invoice-generator";
import { financePermissions, type FinanceRole } from "../lib/workHubFinancePolicy";
import { readInvoiceActivityInTransaction, type InvoiceActivityQuery } from "../assistant/invoice-activity-transaction-read";
import { createTicketInvoicePreparation, ticketInvoicePreparationActorSchema } from "./ticket-invoice-preparation";

/** Parameterizes the extracted, trusted chronology SQL on this exact Drizzle transaction. */
export function invoicePreparationQuery(execute: (statement: ReturnType<typeof sql>) => Promise<unknown>): InvoiceActivityQuery {
  return { async query(text, params = []) {
    const parts = text.split(/\$(\d+)/g);
    const fragments = parts.map((part, index) => index % 2 ? sql`${params[Number(part) - 1]}` : sql.raw(part));
    const result = await execute(sql.join(fragments, sql.empty()));
    return result as { rows: Record<string, unknown>[] };
  } };
}

export function ticketInvoicePreparationForSession(session: SessionPayload) {
  if (session.role !== "vendor") throw Error("invoice_preparation.current_vendor_required");
  const actor = ticketInvoicePreparationActorSchema.parse({ userId: session.userId, vendorId: session.vendorId, membershipId: session.activeMembershipId, sessionVersion: session.sv });
  const service = createTicketInvoicePreparation({
    now: () => new Date(),
    withLockedBatch: (command, trustedActor, run) => db.transaction(async tx => {
      const client = invoicePreparationQuery(statement => tx.execute(statement));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ticket-invoice-preparation:${trustedActor.userId}:${command.operationId}`},0))`);
      // Match generator locks in deterministic order before inspecting links or generating any ticket.
      for (const id of command.tickets.map(ticket => ticket.ticketId).sort((a, b) => a - b)) {
        await tx.execute(sql`select pg_advisory_xact_lock(${0x1949c01},${id})`);
      }
      const rows = await tx.select().from(ticketsTable).where(inArray(ticketsTable.id, command.tickets.map(ticket => ticket.ticketId))).for("update");
      const prior = await tx.select().from(workHubClientOperationsTable).where(and(eq(workHubClientOperationsTable.userId, trustedActor.userId), eq(workHubClientOperationsTable.commandKind, "ticket_invoice_preparation"), eq(workHubClientOperationsTable.operationId, command.operationId)));
      if (prior.length > 1 || prior.length === 1 && (prior[0].ownerOrgType !== "vendor" || prior[0].ownerOrgId !== trustedActor.vendorId || !prior[0].resultJson)) throw Error("invoice_preparation.operation_conflict");
      return run({
        async authorize() {
          const authority = await client.query("SELECT u.id FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3 AND m.org_type='vendor' AND m.vendor_id=$4 AND m.role=$5 FOR SHARE OF u,m", [trustedActor.userId, trustedActor.sessionVersion, trustedActor.membershipId, trustedActor.vendorId, session.membershipRole]);
          if (!authority.rows.length || rows.length !== command.tickets.length || rows.some(ticket => ticket.vendorId !== trustedActor.vendorId)) throw Error("invoice_preparation.current_authority_required");
          const grants = await client.query("SELECT data FROM work_hub_finance_records WHERE org_type='vendor' AND org_id=$1 AND kind='grant' AND record_key=$2 FOR SHARE", [trustedActor.vendorId, String(trustedActor.userId)]);
          const data = grants.rows[0]?.data as { roles?: FinanceRole[] } | undefined;
          const roles = data?.roles ?? [];
          if (!Array.isArray(roles) || roles.some(role => !["billing_manager", "payroll_preparer", "payroll_approver", "payroll_viewer"].includes(role)) || !financePermissions(session.membershipRole === "admin", roles).billing) throw Error("invoice_preparation.billing_permission_required");
        },
        activity: basis => readInvoiceActivityInTransaction({ basis }, session, client),
        async eligible(tickets) {
          for (const selected of tickets) {
            const ticket = rows.find(row => row.id === selected.ticketId);
            if (!ticket || ticket.status !== "approved" || ticket.updatedAt.toISOString() !== selected.expectedUpdatedAt) throw Error("invoice_preparation.ticket_conflict");
          }
          const linked = await tx.select({ ticketId: invoiceTicketLinksTable.ticketId }).from(invoiceTicketLinksTable).where(inArray(invoiceTicketLinksTable.ticketId, tickets.map(ticket => ticket.ticketId)));
          if (linked.length) throw Error("invoice_preparation.ticket_already_invoiced");
        },
        async generate(ticketId) {
          const result = await generateInvoiceForTicket(ticketId, undefined, tx);
          if (!result.ok) throw Error("invoice_preparation.generation_failed");
          return { invoiceId: result.invoiceId, lineCount: result.lineCount };
        },
        prior: () => prior[0]?.resultJson ?? null,
        async save(receipt) {
          await tx.insert(workHubClientOperationsTable).values({ userId: trustedActor.userId, commandKind: "ticket_invoice_preparation", operationId: command.operationId, ownerOrgType: "vendor", ownerOrgId: trustedActor.vendorId, resultJson: receipt, appliedAt: new Date(receipt.acceptedAt) });
          await tx.insert(workHubAuditLogTable).values({ actorUserId: trustedActor.userId, ownerOrgType: "vendor", ownerOrgId: trustedActor.vendorId, action: "ticket_invoice_preparation", subjectType: "invoice_batch", subjectId: command.operationId, source: "canonical_api", operationId: command.operationId, metadata: receipt });
        },
      });
    }),
  });
  return { execute: (raw: unknown) => service.execute(raw, actor), readback: (raw: unknown) => service.readback(raw, actor) };
}
