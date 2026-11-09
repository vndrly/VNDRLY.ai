import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { SessionPayload } from "../lib/session";
import { createTicketWithHistory } from "../lib/create-ticket";

type Binding = { ticketId: number | null; ticketBlocker: string | null; shiftId: string | null };

type Job = { id: number; work_type_id: number; canonical_service_id: number | null; vendor_capability_id: number | null; vendor_partner_service_offer_id: number | null };
type Readiness = Binding & { service?: { workTypeId: number; job?: Job }; shift?: { starts_at: Date; ends_at: Date } };

/** Read-only preflight shared with Next Steps; the mutation rechecks under its transaction locks. */
export async function gateWatchTicketReadiness(
  client: Pick<PoolClient, "query">, session: SessionPayload, stationId: string, siteId: number,
  savedTicketId?: number | null, lock = false,
  expectedShiftId?: string | null,
): Promise<Readiness> {
  const blocked = (code: string, shiftId: string | null = null): Readiness => ({ ticketId: null, ticketBlocker: code, shiftId });
  if (!session.vendorId || !session.userId) return blocked("gate_ticket.vendor_context_required");
  const shifts = (await client.query(`SELECT s.id,s.ticket_number,s.starts_at,s.ends_at
    FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id
    WHERE s.gate_station_id=$1 AND s.site_location_id=$2 AND s.owner_org_type='vendor' AND s.owner_org_id=$3
      AND a.user_id=$4 AND a.status IN ('assigned','accepted','claimed') AND s.milestone_status<>'cancelled'
      AND ($5::uuid IS NULL OR s.id=$5::uuid)
      AND s.starts_at<=now() AND s.ends_at>now() ORDER BY s.starts_at DESC${lock ? " FOR UPDATE OF s,a" : ""}`,
    [stationId, siteId, session.vendorId, session.userId,expectedShiftId??null])).rows;
  const shiftId = shifts.length === 1 ? shifts[0].id as string : null;
  if (shifts.length > 1) return blocked("gate_ticket.ambiguous_shift");
  if (!shifts.length) {
    const future = (await client.query(`SELECT s.id FROM work_hub_shifts s JOIN work_hub_shift_assignments a ON a.shift_id=s.id
      WHERE s.gate_station_id=$1 AND s.site_location_id=$2 AND s.owner_org_type='vendor' AND s.owner_org_id=$3
        AND a.user_id=$4 AND a.status IN ('assigned','accepted','claimed') AND s.milestone_status<>'cancelled'
        AND ($5::uuid IS NULL OR s.id=$5::uuid)
        AND s.starts_at>now() ORDER BY s.starts_at LIMIT 1${lock ? " FOR SHARE OF s,a" : ""}`,
      [stationId,siteId,session.vendorId,session.userId,expectedShiftId??null])).rows[0];
    if (future) return blocked("gate_ticket.shift_not_started",future.id);
    if(expectedShiftId)return blocked("gate_ticket.selected_shift_unavailable",expectedShiftId);
  }
  const relationship = (await client.query(`SELECT r.status FROM partner_vendor_relationships r
    JOIN site_locations s ON s.partner_id=r.partner_id WHERE s.id=$1 AND r.vendor_id=$2${lock ? " FOR SHARE OF r" : ""}`, [siteId, session.vendorId])).rows[0];
  if (["revoked", "restricted"].includes(relationship?.status)) return blocked("gate_ticket.commercial_authority_revoked", shiftId);

  // A saved binding or explicitly scheduled ticket is reusable only in this
  // employer/site and for an authorized Gate work type. Never use a free-text
  // ticket number as proof by itself.
  const explicit = savedTicketId ?? (shifts[0]?.ticket_number?.match(/^\d+$/) ? Number(shifts[0].ticket_number) : null);
  if (explicit != null) {
    const existing = (await client.query(`SELECT t.id FROM tickets t JOIN site_work_assignments a
      ON a.vendor_id=t.vendor_id AND a.site_location_id=t.site_location_id AND a.work_type_id=t.work_type_id AND a.is_gate_contractor=true
      WHERE t.id::text=$1 AND t.vendor_id=$2 AND t.site_location_id=$3 AND t.status IN ('initiated','in_progress')
        AND t.closed_at IS NULL${lock ? " FOR UPDATE OF t" : ""}`, [String(explicit), session.vendorId, siteId])).rows[0];
    return existing ? { ticketId: existing.id, ticketBlocker: null, shiftId } : blocked("gate_ticket.scheduled_ticket_unavailable", shiftId);
  }
  if (shifts[0]?.ticket_number?.trim()) return blocked("gate_ticket.scheduled_ticket_unavailable", shiftId);

  // Resolve an unambiguous approved service; do not pick the first catalog
  // item or synthesize commercial rates when setup is incomplete.
  const serviceRows = (await client.query(`SELECT a.work_type_id FROM site_work_assignments a
    JOIN site_locations s ON s.id=a.site_location_id
    JOIN vendor_work_types v ON v.vendor_id=a.vendor_id AND v.work_type_id=a.work_type_id
    JOIN partner_vendor_work_type_approvals p ON p.partner_id=s.partner_id AND p.vendor_id=a.vendor_id AND p.work_type_id=a.work_type_id
    WHERE a.site_location_id=$1 AND a.vendor_id=$2 AND a.is_gate_contractor=true
      AND coalesce(p.precise_unit_price,p.approved_unit_price)>=0 AND nullif(btrim(p.approved_unit),'') IS NOT NULL
    ORDER BY a.work_type_id${lock ? " FOR SHARE OF a,v,p" : ""}`, [siteId, session.vendorId])).rows;
  const services = [...new Map(serviceRows.map(row => [row.work_type_id, row])).values()];
  let job: Job | undefined;
  if (!services.length) {
    const jobRows = (await client.query(`SELECT j.id,j.work_type_id,j.canonical_service_id,j.vendor_capability_id,j.vendor_partner_service_offer_id
      FROM job_offers j JOIN job_offer_acceptance_snapshots snapshot ON snapshot.job_offer_id=j.id
      JOIN site_work_assignments a ON a.vendor_id=j.vendor_id AND a.site_location_id=j.site_location_id AND a.work_type_id=j.work_type_id AND a.is_gate_contractor=true
      JOIN site_locations site ON site.id=j.site_location_id AND site.partner_id=j.partner_id
      WHERE j.site_location_id=$1 AND j.vendor_id=$2 AND j.status='accepted'
        AND nullif(btrim(snapshot.scope_snapshot->>'afeCode'),'') IS NOT NULL
        AND snapshot.commercial_snapshot->>'unitPrice' ~ '^[0-9]+([.][0-9]+)?$'
        AND nullif(btrim(snapshot.commercial_snapshot->>'unit'),'') IS NOT NULL
        AND nullif(btrim(snapshot.commercial_snapshot->>'currency'),'') IS NOT NULL
      ORDER BY j.id${lock ? " FOR SHARE OF j,snapshot,a" : ""}`, [siteId, session.vendorId])).rows;
    const jobs = [...new Map(jobRows.map(row => [row.id, row])).values()];
    if (jobs.length === 1) job = jobs[0];
    else return blocked(jobs.length ? "gate_ticket.ambiguous_service" : "gate_ticket.approved_service_required", shiftId);
  } else if (services.length !== 1) return blocked("gate_ticket.ambiguous_service", shiftId);
  return { ticketId: null, ticketBlocker: null, shiftId, service: { workTypeId: job?.work_type_id ?? services[0].work_type_id, job }, shift: shifts[0] };
}

/** Caller holds the station/watch transaction locks. No GPS or payable labor is
 * invented: opening a ticket uses the ordinary initiated/pending-arrival state. */
export async function ensureGateWatchTicket(
  client: PoolClient,
  session: SessionPayload,
  stationId: string,
  siteId: number,
  expectedShiftId?: string,
): Promise<Binding> {
  const blocked = (code: string, shiftId: string | null = null): Binding => ({ ticketId: null, ticketBlocker: code, shiftId });
  if (!session.vendorId || !session.userId) return blocked("gate_ticket.vendor_context_required");
  const duties = await client.query(`SELECT d.id,d.post_coverage,w.id AS watch_id,w.started_at
    FROM gate_duty_sessions d JOIN gate_shifts w ON w.station_id=d.station_id AND w.operator_id=d.user_id AND w.ended_at IS NULL
    WHERE d.station_id=$1 AND d.user_id=$2 AND d.ended_at IS NULL FOR UPDATE OF d,w`, [stationId, session.userId]);
  const duty = duties.rows[0];
  if (!duty) return blocked("gate_ticket.active_watch_required");
  if (duty.post_coverage?.vendorId !== session.vendorId) return blocked("gate_ticket.employer_changed");

  const readiness = await gateWatchTicketReadiness(client, session, stationId, siteId, duty.post_coverage?.ticketId, true, expectedShiftId);
  const save = async (result: Binding) => {
    await client.query(`UPDATE gate_duty_sessions SET work_hub_shift_id=$2,source_legacy_shift_id=$3,
      post_coverage=coalesce(post_coverage,'{}'::jsonb)||$4::jsonb WHERE id=$1`,
      [duty.id, result.shiftId, duty.watch_id, JSON.stringify({ ticketId: result.ticketId, ticketBlocker: result.ticketBlocker })]);
    return result;
  };
  if (expectedShiftId && readiness.ticketBlocker) return readiness;
  if (readiness.ticketBlocker || readiness.ticketId) return save(readiness);
  const { service, shift, shiftId } = readiness;
  const job = service!.job;
  const worker = (await client.query(`SELECT p.id FROM vendor_people p JOIN user_org_memberships m ON m.vendor_people_id=p.id
    WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND ($3::int IS NULL OR m.id=$3)
      AND p.user_id=m.user_id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL
    ORDER BY p.id LIMIT 1 FOR SHARE OF p,m`, [session.userId, session.vendorId, session.activeMembershipId ?? null])).rows[0];
  const ticket = await createTicketWithHistory(drizzle(client), {
    siteLocationId: siteId, vendorId: session.vendorId, workTypeId: service!.workTypeId,
    ...(job ? { engagementJobOfferId: job.id, canonicalServiceId: job.canonical_service_id,
      vendorCapabilityId: job.vendor_capability_id, vendorPartnerServiceOfferId: job.vendor_partner_service_offer_id } : {}),
    status: "initiated", intakeChannel: "vendor_field_self_service", createdById: session.userId,
    fieldEmployeeId: worker?.id ?? null,
    description: "Gate watch", scheduledStartAt: shift?.starts_at ?? duty.started_at,
    scheduledDurationMinutes: shift ? Math.ceil((new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 60000) : null,
  }, { userId: session.userId, role: session.role ?? null, reason: `gate_watch_assumed:${duty.watch_id}` });
  return save({ ticketId: ticket.id, ticketBlocker: null, shiftId });
}
