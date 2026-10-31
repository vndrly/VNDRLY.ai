import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

type Executor = { execute(query: SQL): Promise<{ rows: Record<string, any>[] }> };
export class TicketSubmissionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type TicketSubmission = {
  revision: number; submittedAt: string; submittedById: number;
  ticketId: number; jobId: number | null; afe: string | null;
  ticket: Record<string, any>; job: Record<string, any> | null;
  lineItems: Record<string, any>[]; notes: Record<string, any>[];
  checkIns: Record<string, any>[]; gps: Record<string, any>[];
  assignmentRates?: Record<string, any>[];
  attachmentReceipts?: Record<string, any>[];
  finance?: {
    site: Record<string, any>; vendor: Record<string, any>; partner: Record<string, any>;
    workType: Record<string, any> | null; taxRate: Record<string, any> | null;
    vendorWorkType: Record<string, any> | null; partnerApproval: Record<string, any> | null;
    billing: Record<string, any> | null;
  };
  gate: Record<string, any> | null; digest: string;
};
export function submissionDigest(value: Omit<TicketSubmission, "digest">): string {
  // PostgreSQL JSONB changes object key order. Canonicalize recursively before hashing.
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function reviewedSubmission(ticket: Record<string, any>, expected: unknown): TicketSubmission | null {
  const revision = Number(ticket.submission_revision ?? 0);
  if (!revision) return null; // Historical submissions remain reviewable without inventing evidence.
  if (String(expected ?? "") !== String(revision))
    throw new TicketSubmissionError("ticket.submission_changed", "Reload the proof sheet before reviewing this submission.");
  const packet = (ticket.proof_submissions ?? []).find((p: TicketSubmission) => p.revision === revision) as TicketSubmission | undefined;
  if (!packet) throw new TicketSubmissionError("ticket.proof_missing", "The submitted proof sheet is missing.");
  const { digest, ...content } = packet;
  if (submissionDigest(content) !== digest || packet.ticketId !== ticket.id)
    throw new TicketSubmissionError("ticket.proof_changed", "The submitted proof sheet failed its integrity check.");
  return packet;
}

/** Call inside the same transaction as submission; never rewrite prior revisions. */
export async function freezeTicketSubmission(tx: Executor, ticketId: number, actorUserId: number): Promise<TicketSubmission> {
  const ticket = (await tx.execute(sql`SELECT * FROM tickets WHERE id=${ticketId} FOR UPDATE`)).rows[0];
  if (!ticket) throw new TicketSubmissionError("ticket.not_found", "Ticket not found.");
  const jobId = ticket.engagement_job_offer_id ?? ticket.job_offer_id ?? null;
  let job: Record<string, any> | null = null;
  let afe: string | null = null;
  if (jobId) {
    job = (await tx.execute(sql`
      SELECT j.id,j.partner_id,j.vendor_id,j.site_location_id,j.work_type_id,
        a.scope_snapshot,a.commercial_snapshot,a.offer_version,a.accepted_by_id,a.created_at
      FROM job_offers j JOIN job_offer_acceptance_snapshots a ON a.job_offer_id=j.id
      JOIN site_locations s ON s.id=j.site_location_id AND s.partner_id=j.partner_id
      WHERE j.id=${jobId} AND j.status='accepted' AND j.vendor_id=${ticket.vendor_id}
        AND j.site_location_id=${ticket.site_location_id} AND j.work_type_id=${ticket.work_type_id}
    `)).rows[0] ?? null;
    afe = typeof job?.scope_snapshot?.afeCode === "string" ? job.scope_snapshot.afeCode.trim() : null;
    if (!job || !afe) throw new TicketSubmissionError("ticket.job_afe_required", "The accepted job must include the partner's AFE before submitting work.");
  } else {
    const scope = (await tx.execute(sql`SELECT COALESCE(a.afe,s.afe) AS afe FROM site_locations s
      LEFT JOIN site_work_assignments a ON a.site_location_id=s.id AND a.vendor_id=${ticket.vendor_id} AND a.work_type_id=${ticket.work_type_id}
      WHERE s.id=${ticket.site_location_id}`)).rows[0];
    afe = scope?.afe ?? null;
  }
  const lineItems = (await tx.execute(sql`SELECT * FROM ticket_line_items WHERE ticket_id=${ticketId} ORDER BY id`)).rows;
  const notes = (await tx.execute(sql`SELECT * FROM ticket_note_logs WHERE ticket_id=${ticketId} AND deleted_at IS NULL ORDER BY id`)).rows;
  const checkIns = (await tx.execute(sql`SELECT * FROM ticket_check_ins WHERE ticket_id=${ticketId} ORDER BY id`)).rows;
  if (jobId && checkIns.some(row => row.check_out_at == null))
    throw new TicketSubmissionError("ticket.open_crew_sessions", "Close every crew session before submitting this job's proof sheet.");
  const assignmentRates = (await tx.execute(sql`SELECT * FROM ticket_assignment_rates WHERE ticket_id=${ticketId} ORDER BY id`)).rows;
  const gps = (await tx.execute(sql`SELECT * FROM gps_logs WHERE ticket_id=${ticketId} ORDER BY id`)).rows;
  const gate = (await tx.execute(sql`SELECT tool_output FROM assistant_action_audit
    WHERE target_type='gate-billing-ticket' AND target_id=${String(ticketId)} AND vendor_id=${ticket.vendor_id}
    ORDER BY id DESC LIMIT 1`)).rows[0]?.tool_output ?? null;
  if (!job && gate?.agreement?.afe) afe = gate.agreement.afe;
  if (jobId && !lineItems.length) throw new TicketSubmissionError("ticket.claim_required", "Add the services and quantities being submitted before sending the proof sheet.");
  if (jobId && !notes.length && !ticket.notes?.trim() && !gate)
    throw new TicketSubmissionError("ticket.proof_required", "Add a work note or attachment before submitting the proof sheet.");
  const includedNoteIds = new Set(notes.map(note => String(note.id)));
  const attachmentReceipts = (await tx.execute(sql`SELECT tool_output FROM assistant_action_audit
    WHERE target_type='ticket-photo-association' AND tool_output->>'ticketId'=${String(ticketId)}
    ORDER BY id`)).rows.map(row => row.tool_output).filter(receipt => receipt && includedNoteIds.has(String(receipt.noteId)));
  // Store only billing-relevant fields, not whole organization records. Explicit
  // null overrides are frozen too: a future tax or billing configuration cannot
  // silently become part of an already submitted claim.
  const finance = (await tx.execute(sql`SELECT jsonb_build_object(
    'site', jsonb_build_object('id',s.id,'partnerId',s.partner_id,'name',s.name,'state',s.state,
      'combinedTaxRate',s.combined_tax_rate,'merchandiseTaxRate',s.merchandise_tax_rate,
      'stateTaxRate',s.state_tax_rate,'laborTaxRate',s.labor_tax_rate,'localTaxRate',s.local_tax_rate,
      'taxJurisdictionPostalCode',s.tax_jurisdiction_postal_code,'taxJurisdictionLabel',s.tax_jurisdiction_label),
    'vendor', jsonb_build_object('id',v.id,'name',v.name,'dailyOtHours',v.daily_ot_hours,'weeklyOtHours',v.weekly_ot_hours),
    'partner', jsonb_build_object('id',p.id,'name',p.name),
    'workType', CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('id',w.id,'name',w.name,'category',w.category,'taxTreatment',w.tax_treatment) END,
    'taxRate', CASE WHEN tr.id IS NULL THEN NULL ELSE jsonb_build_object('state',tr.state,'rate',tr.rate) END,
    'vendorWorkType', CASE WHEN vw.id IS NULL THEN NULL ELSE jsonb_build_object('taxTreatment',vw.tax_treatment) END,
    'partnerApproval', CASE WHEN pa.id IS NULL THEN NULL ELSE jsonb_build_object('taxTreatment',pa.tax_treatment) END,
    'billing', CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('cadence',b.cadence,'paymentTermsDays',b.payment_terms_days,
      'remitToAddress',b.remit_to_address,'remitToName',b.remit_to_name,'mileageAutoSuggest',b.mileage_auto_suggest,
      'mileageRate',b.mileage_rate,'overtimeMultiplier',b.overtime_multiplier,'lateFeeRule',b.late_fee_rule,
      'defaultIncomeCategoryOverrides',b.default_income_category_overrides) END
    ) AS finance
    FROM site_locations s JOIN vendors v ON v.id=${ticket.vendor_id} JOIN partners p ON p.id=s.partner_id
    LEFT JOIN work_types w ON w.id=${ticket.work_type_id}
    LEFT JOIN tax_rates tr ON tr.state=s.state
    LEFT JOIN vendor_work_types vw ON vw.vendor_id=v.id AND vw.work_type_id=${ticket.work_type_id}
    LEFT JOIN partner_vendor_work_type_approvals pa ON pa.partner_id=p.id AND pa.vendor_id=v.id AND pa.work_type_id=${ticket.work_type_id}
    LEFT JOIN vendor_partner_billing_settings b ON b.vendor_id=v.id AND b.partner_id=p.id
    WHERE s.id=${ticket.site_location_id}`)).rows[0]?.finance as TicketSubmission["finance"];
  if (!finance) throw new TicketSubmissionError("ticket.billing_context_missing", "The job's billing context is unavailable. Reload before submitting.");
  // Normalize dates to JSON strings once so storage and the returned digest agree.
  const { proof_submissions: _history, ...ticketEvidence } = ticket;
  const content = JSON.parse(JSON.stringify({ revision: Number(ticket.submission_revision ?? 0) + 1,
    submittedAt: new Date().toISOString(), submittedById: actorUserId,
    ticketId, jobId, afe, ticket: ticketEvidence, job, lineItems, notes, checkIns, assignmentRates, gps, gate, finance, attachmentReceipts,
  })) as Omit<TicketSubmission, "digest">;
  const packet: TicketSubmission = { ...content, digest: submissionDigest(content) };
  await tx.execute(sql`UPDATE tickets SET submission_revision=${packet.revision}, approved_submission_revision=NULL,
    proof_submissions=COALESCE(proof_submissions,'[]'::jsonb) || ${JSON.stringify([packet])}::jsonb WHERE id=${ticketId}`);
  return packet;
}
