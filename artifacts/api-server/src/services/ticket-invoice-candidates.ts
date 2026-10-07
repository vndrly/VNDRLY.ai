import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import type { InvoiceActivityQuery } from "../assistant/invoice-activity-transaction-read";
import {
  financePermissions,
  type FinanceRole,
} from "../lib/workHubFinancePolicy";
import { ticketInvoicePreparationActorSchema } from "./ticket-invoice-preparation";

export const ticketInvoiceCandidatesInputSchema = z
  .object({
    limit: z.number().int().min(1).max(20).default(20),
    afterTicketId: z.number().int().nonnegative().default(0),
  })
  .strict();
export const ticketInvoiceCandidatesOutputSchema = z
  .object({
    company: z
      .object({ type: z.literal("vendor"), id: z.number().int().positive() })
      .strict(),
    observedAt: z.iso.datetime(),
    source: z.literal("canonical_approved_uninvoiced_tickets"),
    tickets: z
      .array(
        z
          .object({
            ticketId: z.number().int().positive(),
            siteLocationId: z.number().int().positive(),
            status: z.literal("approved"),
            expectedUpdatedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(20),
    page: z
      .object({
        limit: z.number().int().min(1).max(20),
        nextAfterTicketId: z.number().int().positive().nullable(),
        truncated: z.boolean(),
      })
      .strict(),
    automaticApprovalCreated: z.literal(false),
    invoicesPrepared: z.literal(false),
  })
  .strict();

/** Shared actual billing predicate, held on this caller's transaction for read and mutation. */
export async function authorizeTicketInvoiceBilling(
  session: SessionPayload,
  client: InvoiceActivityQuery,
) {
  if (session.role !== "vendor")
    throw Error("invoice_preparation.current_vendor_required");
  const actor = ticketInvoicePreparationActorSchema.parse({
    userId: session.userId,
    vendorId: session.vendorId,
    membershipId: session.activeMembershipId,
    sessionVersion: session.sv,
  });
  const authority = await client.query(
    "SELECT u.id FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3 AND m.org_type='vendor' AND m.vendor_id=$4 AND m.role=$5 FOR SHARE OF u,m",
    [
      actor.userId,
      actor.sessionVersion,
      actor.membershipId,
      actor.vendorId,
      session.membershipRole,
    ],
  );
  if (!authority.rows.length)
    throw Error("invoice_preparation.current_authority_required");
  const grants = await client.query(
    "SELECT data FROM work_hub_finance_records WHERE org_type='vendor' AND org_id=$1 AND kind='grant' AND record_key=$2 FOR SHARE",
    [actor.vendorId, String(actor.userId)],
  );
  const data = grants.rows[0]?.data as { roles?: FinanceRole[] } | undefined;
  const roles = data?.roles ?? [];
  if (
    !Array.isArray(roles) ||
    roles.some(
      (role) =>
        ![
          "billing_manager",
          "payroll_preparer",
          "payroll_approver",
          "payroll_viewer",
        ].includes(role),
    ) ||
    !financePermissions(session.membershipRole === "admin", roles).billing
  )
    throw Error("invoice_preparation.billing_permission_required");
  return actor;
}

/** Candidates are a current read, not a reservation, completeness guarantee or automatic approval. */
export async function readTicketInvoiceCandidates(
  raw: unknown,
  session: SessionPayload,
  client: InvoiceActivityQuery,
  now = new Date(),
) {
  const input = ticketInvoiceCandidatesInputSchema.parse(raw);
  const actor = await authorizeTicketInvoiceBilling(session, client);
  const result = await client.query(
    'SELECT t.id,t.vendor_id AS "vendorId",t.site_location_id AS "siteLocationId",t.status,t.updated_at AS "updatedAt" FROM tickets t WHERE t.vendor_id=$1 AND t.status=\'approved\' AND t.id>$2 AND NOT EXISTS(SELECT 1 FROM invoice_ticket_links l WHERE l.ticket_id=t.id) ORDER BY t.id ASC LIMIT $3',
    [actor.vendorId, input.afterTicketId, input.limit + 1],
  );
  const rows = z
    .array(
      z
        .object({
          id: z.number().int().positive(),
          vendorId: z.literal(actor.vendorId),
          siteLocationId: z.number().int().positive(),
          status: z.literal("approved"),
          updatedAt: z.union([z.date(), z.iso.datetime()]),
        })
        .strict(),
    )
    .max(input.limit + 1)
    .parse(result.rows);
  if (
    rows.some(
      (row, index) =>
        row.id <= input.afterTicketId ||
        (index > 0 && rows[index - 1].id >= row.id),
    )
  )
    throw Error("invoice_preparation.invalid_candidates");
  const truncated = rows.length > input.limit,
    selected = rows.slice(0, input.limit);
  return ticketInvoiceCandidatesOutputSchema.parse({
    company: { type: "vendor", id: actor.vendorId },
    observedAt: now.toISOString(),
    source: "canonical_approved_uninvoiced_tickets",
    tickets: selected.map((row) => ({
      ticketId: row.id,
      siteLocationId: row.siteLocationId,
      status: row.status,
      expectedUpdatedAt: new Date(row.updatedAt).toISOString(),
    })),
    page: {
      limit: input.limit,
      nextAfterTicketId: truncated ? selected.at(-1)!.id : null,
      truncated,
    },
    automaticApprovalCreated: false,
    invoicesPrepared: false,
  });
}
