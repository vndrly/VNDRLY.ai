import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { financePermissions, type FinanceRole } from "../lib/workHubFinancePolicy";

const inputSchema = z.object({ basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]).default("recorded_invoice_activity") }).strict();
const rowSchema = z.object({ kind: z.enum(["manual_issue", "ticket_send_attempt", "provider_acceptance"]), recordId: z.string().min(1).max(100).nullable(), eventId: z.string().min(1).max(100).nullable(), at: z.union([z.date(), z.string()]).nullable(), records: z.coerce.number().int().nonnegative(), undated: z.coerce.number().int().nonnegative() });

/** Complete company chronology, not a createdAt window or a delivery assertion. */
export type InvoiceActivityQuery = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export async function readInvoiceActivityInTransaction(raw: unknown, session: SessionPayload, client: InvoiceActivityQuery, now = new Date()) {
  const input = inputSchema.parse(raw);
  const type = session.role === "vendor" ? "vendor" : session.role === "partner" ? "partner" : null;
  const id = type === "vendor" ? session.vendorId : session.partnerId;
  if (!type || !id || !session.userId || !session.activeMembershipId || !session.sv || !Number.isFinite(now.getTime())) throw Error("invoice_activity.current_company_required");
    const authority = await client.query("SELECT u.id FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3 AND m.org_type=$4 AND COALESCE(m.vendor_id,m.partner_id)=$5 AND m.role=$6 FOR SHARE OF u,m", [session.userId, session.sv, session.activeMembershipId, type, id, session.membershipRole]);
    if (!authority.rows.length) throw Error("invoice_activity.current_authority_required");
    const grants = await client.query("SELECT data FROM work_hub_finance_records WHERE org_type=$1 AND org_id=$2 AND kind='grant' AND record_key=$3 FOR SHARE", [type, id, String(session.userId)]);
    const grant = grants.rows[0] ? z.record(z.string(), z.unknown()).parse(grants.rows[0].data) : {};
    const roles = z.array(z.enum(["billing_manager", "payroll_preparer", "payroll_approver", "payroll_viewer"])).safeParse(grant.roles ?? []);
    if (!roles.success || !financePermissions(session.membershipRole === "admin", roles.data as FinanceRole[]).billing) throw Error("invoice_activity.billing_permission_required");
    const column = type === "vendor" ? "vendor_id" : "partner_id";
    const result = await client.query(`WITH events AS (
      SELECT 'manual_issue'::text kind,r.id::text record_id,r.id::text event_id,
        CASE WHEN r.data->>'approvedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN r.data->>'approvedAt' END at
      FROM work_hub_finance_records r WHERE r.org_type=$1 AND r.org_id=$2 AND r.kind='invoice' AND r.data->>'status' IN ('issued','paid')
      UNION ALL SELECT 'ticket_send_attempt',i.id::text,l.id::text,l.sent_at::text FROM invoice_send_log l JOIN invoices i ON i.id=l.invoice_id WHERE i.${column}=$2
      UNION ALL SELECT 'ticket_send_attempt',i.id::text,NULL,i.sent_at::text FROM invoices i WHERE i.${column}=$2 AND (i.sent_at IS NOT NULL OR i.status IN ('sent','overdue','paid')) AND NOT EXISTS(SELECT 1 FROM invoice_send_log l WHERE l.invoice_id=i.id)
      UNION ALL SELECT 'provider_acceptance',i.id::text,l.id::text,CASE WHEN NULLIF(trim(l.sendgrid_message_id),'') IS NOT NULL THEN l.sent_at::text END FROM invoice_send_log l JOIN invoices i ON i.id=l.invoice_id WHERE i.${column}=$2 AND l.failure_message IS NULL
    ), kinds AS (SELECT unnest(ARRAY['manual_issue','ticket_send_attempt','provider_acceptance']) kind)
    SELECT k.kind,(SELECT record_id FROM events e WHERE e.kind=k.kind AND at IS NOT NULL ORDER BY at::timestamptz DESC,event_id DESC NULLS LAST LIMIT 1) AS "recordId",
      (SELECT event_id FROM events e WHERE e.kind=k.kind AND at IS NOT NULL ORDER BY at::timestamptz DESC,event_id DESC NULLS LAST LIMIT 1) AS "eventId",
      (SELECT at FROM events e WHERE e.kind=k.kind AND at IS NOT NULL ORDER BY at::timestamptz DESC,event_id DESC NULLS LAST LIMIT 1) AS at,
      (SELECT count(*) FROM events e WHERE e.kind=k.kind) records,(SELECT count(*) FROM events e WHERE e.kind=k.kind AND at IS NULL) undated FROM kinds k`, [type, id]);
    const rows = z.array(rowSchema).length(3).parse(result.rows);
    if (new Set(rows.map(row => row.kind)).size !== 3) throw Error("invoice_activity.invalid_evidence");
    const events = rows.map(row => {
      const timestamp = row.at === null ? null : new Date(row.at).getTime();
      if (timestamp !== null && (!Number.isFinite(timestamp) || timestamp > now.getTime()) || row.undated > row.records || row.records > 0 && row.undated < row.records && (!row.recordId || timestamp === null)) throw Error("invoice_activity.invalid_evidence");
      return { kind: row.kind, observedRecords: row.records, undatedRecords: row.undated, latestAt: timestamp === null ? null : new Date(timestamp).toISOString(), sourceReference: row.recordId ? `${row.kind === "manual_issue" ? "work_hub_finance_records" : "invoices"}:${row.recordId}${row.eventId && row.kind !== "manual_issue" ? `/invoice_send_log:${row.eventId}` : ""}` : null };
    });
    const selected = events.filter(event => input.basis === "provider_acceptance" ? event.kind === "provider_acceptance" : event.kind !== "provider_acceptance");
    const latest = selected.map(event => event.latestAt).filter((at): at is string => at !== null).sort().at(-1) ?? null;
    const unknown = selected.some(event => event.undatedRecords > 0);
    const state = unknown ? "unknown" : latest ? "observed" : "no_recorded_event";
    const elapsedDays = latest ? (now.getTime() - Date.parse(latest)) / 86400000 : null;
    return { basis: input.basis, observedAt: now.toISOString(), company: { type, id }, events, state, latestAt: latest, elapsedDays, thresholdDays: 15 as const,
      exceeds15Days: state === "observed" ? elapsedDays! > 15 : null,
      preparationRecommended: state === "observed" && elapsedDays! > 15,
      draftPrepared: false, deliveryVerified: false,
      limitations: ["Send timestamps record vendor intent, including failed email attempts. Provider acceptance requires a saved provider message ID and no failure; missing IDs are unverified, including disabled-email stub records. Acceptance is not recipient delivery.", "No recorded event means none in this company's canonical stores; external or imported billing history may be unknown.", "This read neither establishes approved-ticket draft eligibility nor creates or sends an invoice."] };
}
