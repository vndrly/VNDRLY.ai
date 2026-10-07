import { GateShiftStaffingCandidateEvidenceSchema } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type { Pool, PoolClient } from "pg";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { requireChangeOverAccess } from "../services/gate-change-over";
import { evaluateAssignmentEligibility } from "../services/workforce-coverage";
import { requireChatGptReadableTool } from "./chatgpt-tool-access";

export const GATE_STAFFING_CANDIDATE_INPUT = z.object({ shiftId: z.uuid() }).strict();
export const GATE_STAFFING_CANDIDATE_OUTPUT = GateShiftStaffingCandidateEvidenceSchema;
export const GATE_STAFFING_CANDIDATE_OUTPUT_SCHEMA = { ...z.toJSONSchema(GATE_STAFFING_CANDIDATE_OUTPUT), type: "object" as const };
const date = (value: unknown) => { const result = new Date(String(value)); if (!Number.isFinite(result.getTime())) throw Error("gate_candidates.invalid_record"); return result; };
const expirationDate = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
const personSchema = z.object({ id: z.number().int().positive(), user_id: z.number().int().positive(), first_name: z.string().max(200), last_name: z.string().max(200) });

export function gateStaffingCandidatesAvailable(session: SessionPayload, scopes: string[]) {
  try {
    requireChatGptReadableTool(session, scopes, "query_gate_stations");
    requireChatGptReadableTool(session, scopes, "query_workforce_coverage");
    return Boolean(["vendor", "field_employee"].includes(session.role ?? "") && session.vendorId && session.userId && session.activeMembershipId && session.sv);
  } catch { return false; }
}

/** Recorded staffing evidence only. Not an assignment, contact attempt or physical qualification proof. */
export async function readGateStaffingCandidates(raw: unknown, session: SessionPayload, scopes: string[], database: Pick<Pool, "connect"> = pool, authorize = requireChangeOverAccess, now = new Date()) {
  const input = GATE_STAFFING_CANDIDATE_INPUT.parse(raw);
  if (!gateStaffingCandidatesAvailable(session, scopes)) throw Error("gate_candidates.current_vendor_and_staffing_scope_required");
  const client = await database.connect();
  try { return await readGateStaffingCandidatesForClient(input.shiftId, session, client, authorize, now); }
  finally { client.release(); }
}

/** Cookie routes enforce their capability; transactions reuse the same canonical evidence. */
export async function readGateStaffingCandidatesForClient(
  shiftId: string, session: SessionPayload, client: Pick<PoolClient, "query">,
  authorize = requireChangeOverAccess, now = new Date(), selectedUserIds?: number[], supervisor = true,
) {
  const input = GATE_STAFFING_CANDIDATE_INPUT.parse({ shiftId });
  if (!["vendor", "field_employee"].includes(session.role ?? "") || !session.vendorId || !session.userId) throw Error("gate_candidates.current_vendor_required");
    const load = async () => {
      const result = await client.query(`SELECT s.id,s.version,s.starts_at,s.ends_at,s.qualification_codes,g.site_id,c.required_count,c.assigned_count,c.actual_count,c.state AS coverage_state
        FROM work_hub_shifts s JOIN gate_stations g ON g.id=s.gate_station_id LEFT JOIN workforce_coverage_records c ON c.shift_id=s.id
        WHERE s.id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.site_location_id=g.site_id`, [input.shiftId, session.vendorId]);
      if (result.rows.length !== 1) throw Error("gate_candidates.shift_unavailable");
      return result.rows[0];
    };
    const shift = await load();
    const contract = async () => {
      const result = await client.query("SELECT a.id FROM site_work_assignments a JOIN site_locations s ON s.id=a.site_location_id JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id AND r.vendor_id=a.vendor_id AND r.status='approved' WHERE a.site_location_id=$1 AND a.vendor_id=$2 AND a.is_gate_contractor=true AND s.is_active=true AND s.hidden=false", [shift.site_id, session.vendorId]);
      if (!result.rows.length) throw Error("gate_candidates.contract_required");
    };
    await contract();
    const access = await authorize(client, session, Number(shift.site_id));
    if (supervisor && !access.supervisor) throw Error("gate_candidates.supervisor_required");
    if (!supervisor && selectedUserIds?.some(id => id !== session.userId)) throw Error("gate_candidates.supervisor_required");
    const start = date(shift.starts_at), end = date(shift.ends_at);
    if (end <= start || end.getTime() - start.getTime() > 7 * 86400000 || !Number.isFinite(now.getTime())) throw Error("gate_candidates.invalid_interval");
    const codes = z.array(z.string().trim().min(1).max(100)).max(50).nullable().parse(shift.qualification_codes) ?? [];
    const people = await client.query(`SELECT p.id,p.user_id,p.first_name,p.last_name FROM vendor_people p JOIN users u ON u.id=p.user_id
      WHERE p.vendor_id=$1 AND p.is_active=true AND p.deleted_at IS NULL AND u.suspended_at IS NULL
      AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=u.id AND m.org_type='vendor' AND m.vendor_id=$1)
      AND EXISTS(SELECT 1 FROM vendor_person_site_access a WHERE a.vendor_people_id=p.id AND a.site_location_id=$2 AND a.is_active=true)
      AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
        OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role IN ('gatekeeper','gate_supervisor')))
      AND ($3::integer[] IS NULL OR p.user_id=ANY($3::integer[]))
      ORDER BY p.id LIMIT 26`, [session.vendorId, shift.site_id, selectedUserIds ?? null]);
    const candidates = [];
    for (const rawPerson of people.rows.slice(0, 25)) {
      const person = personSchema.parse(rawPerson);
      const certs = await client.query("SELECT id,name,expiration_date,vendor_verified_at FROM employee_certifications WHERE employee_id=$1 AND deleted_at IS NULL", [person.id]);
      const deadline = end.toISOString().slice(0, 10);
      const requirements = codes.map(code => {
        const matches = certs.rows.filter(cert => {
          const expires = expirationDate(cert.expiration_date);
          return typeof cert.name === "string" && cert.name.toLowerCase() === code.toLowerCase() && expires !== null && expires >= deadline;
        });
        return { code, currentRecorded: matches.length > 0, vendorVerified: matches.some(cert => cert.vendor_verified_at != null), sourceIds: matches.map(cert => z.number().int().positive().parse(cert.id)) };
      });
      const assigned = await client.query(`SELECT s.id,s.starts_at,s.ends_at FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id=a.shift_id
        WHERE a.user_id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.id<>$3 AND a.status NOT IN ('cancelled','declined') AND s.milestone_status<>'cancelled' AND s.ends_at>=$4 AND s.starts_at<$5`, [person.user_id, session.vendorId, shift.id, new Date(start.getTime() - 7 * 86400000), new Date(end.getTime() + 7 * 86400000)]);
      const intervals = assigned.rows.map(item => ({ start: date(item.starts_at), end: date(item.ends_at) }));
      const overlaps = intervals.some(item => item.start < end && item.end > start);
      const restWindow = intervals.some(item => Math.abs(item.end.getTime() - start.getTime()) < 8 * 3600000 || Math.abs(end.getTime() - item.start.getTime()) < 8 * 3600000);
      const overtime = (intervals.reduce((sum, item) => sum + Math.max(0, item.end.getTime() - item.start.getTime()), end.getTime() - start.getTime()) / 3600000) > 40;
      const meeting = await client.query(`SELECT o.id FROM work_hub_meeting_occurrences o JOIN work_hub_meetings m ON m.id=o.meeting_id JOIN work_hub_meeting_participants p ON p.occurrence_id=o.id
        WHERE p.user_id=$1 AND p.removed_at IS NULL AND m.owner_org_type='vendor' AND m.owner_org_id=$2 AND o.status NOT IN ('ended','cancelled') AND o.starts_at<$4 AND o.ends_at>$3 LIMIT 1`, [person.user_id, session.vendorId, start, end]);
      const availability = await client.query("SELECT id,starts_at,ends_at,available,recurrence FROM work_hub_availability WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND starts_at<$4 AND ends_at>$3", [person.user_id, session.vendorId, start, end]);
      const unsupportedRecurrence = availability.rows.some(item => item.recurrence != null);
      const explicitlyUnavailable = availability.rows.some(item => item.available === false);
      const recordedAvailable = availability.rows.some(item => item.available === true && item.recurrence == null && date(item.starts_at) <= start && date(item.ends_at) >= end);
      const eligibility = evaluateAssignmentEligibility({ accountState: "active", credentialsCurrent: requirements.every(item => item.currentRecorded), overlaps: overlaps || meeting.rows.length > 0, restWindow, overtime });
      candidates.push({ vendorPeopleId: person.id, userId: person.user_id, name: `${person.first_name} ${person.last_name}`.trim(), requirements,
        qualificationState: codes.length ? requirements.every(item => item.currentRecorded && item.vendorVerified) ? "recorded_requirements_verified" : "missing_or_unverified" : "unknown_no_configured_requirements",
        availability: explicitlyUnavailable || overlaps || meeting.rows.length > 0 ? "recorded_conflict" : unsupportedRecurrence ? "unknown_recurrence" : recordedAvailable ? "recorded_available" : "unknown_no_window",
        eligibility, contact: { workHubUserId: person.user_id, reachability: "unknown" }, sourceReference: `vendor_people:${person.id}` });
    }
    const fresh = await authorize(client, session, Number(shift.site_id));
    await contract();
    if ((supervisor && !fresh.supervisor) || JSON.stringify(await load()) !== JSON.stringify(shift)) throw Error("gate_candidates.context_changed");
    return GATE_STAFFING_CANDIDATE_OUTPUT.parse({ shiftId: input.shiftId, shiftVersion: z.number().int().positive().parse(shift.version), siteId: Number(shift.site_id), startsAt: start.toISOString(), endsAt: end.toISOString(), observedAt: now.toISOString(), candidates, truncated: people.rows.length > 25,
      coverage: shift.coverage_state == null ? null : { state: String(shift.coverage_state), required: Number(shift.required_count), assigned: Number(shift.assigned_count), recordedActual: Number(shift.actual_count) },
      assignmentMade: false, messageSent: false, limitations: ["Availability and qualifications are saved records, not physical readiness or guaranteed reachability. Other-company commitments, unrecorded duties and recurring availability are not verified. Certificates without expiration dates do not establish current qualification; no explicit nonexpiring designation exists here.", "Only direct current-company Gate-role members with selected site access are included; sponsored external workers require a separate canonical candidate adapter.", "Eligibility applies the existing assignment policy only to recorded same-company shifts in the seven-day window on each side of this interval. Rest and overtime are bounded observations, not regulatory or complete personal-schedule clearance. Assignment authorization, qualifications and availability must be checked again when assigning. Coverage counts do not prove an uncovered physical interval."] });
}
