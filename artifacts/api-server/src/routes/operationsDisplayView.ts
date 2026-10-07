import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { displayCommandActor } from "../assistant/operations-display-command-repository";
import { callNaturalVoiceDomainApi } from "../assistant/natural-voice-write-tools";
import { requireChangeOverAccess } from "../services/gate-change-over";
import { createOperationsDisplayViewer, type OperationsDisplayViewState } from "../services/operations-display-view";

const router = Router();
const date = (value: unknown) => { const result = value instanceof Date ? new Date(value.getTime()) : new Date(String(value)); return Number.isFinite(result.getTime()) ? result.toISOString() : null; };
const unavailable = () => { throw Object.assign(Error("display_view.unavailable"), { status: 403 }); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Read-only saved monitor state, never pairing-token or OS-display authentication. */
export async function authorizeDisplayView(session: SessionPayload, displayId: string, monitorId: string): Promise<OperationsDisplayViewState | null> {
  const actor = displayCommandActor(session);
  const current = await pool.query(`SELECT d.id,d.name,d.privacy_mode,d.site_allowlist,d.view_allowlist,d.updated_at,
    o.id AS monitor_id,o.name AS monitor_name,o.current_view,o.current_site_location_id,o.current_meeting_occurrence_id
    FROM operations_displays d JOIN operations_display_outputs o ON o.display_id=d.id
    JOIN users u ON u.id=d.registered_by_user_id
    JOIN user_org_memberships m ON m.id=$4 AND m.user_id=u.id AND m.org_type=d.owner_org_type AND COALESCE(m.vendor_id,m.partner_id)=d.owner_org_id
    JOIN work_hub_devices c ON c.id=d.registered_companion_device_id AND c.user_id=u.id AND c.owner_org_type=d.owner_org_type AND c.owner_org_id=d.owner_org_id AND c.revoked_at IS NULL
    WHERE d.id=$1 AND o.id=$2 AND d.registered_by_user_id=$3 AND d.owner_org_type=$5 AND d.owner_org_id=$6
    AND d.revoked_at IS NULL AND u.session_version=$7 AND u.suspended_at IS NULL
    AND (m.role='admin' OR ($8::boolean AND u.role='admin'))`, [displayId, monitorId, actor.userId, actor.membershipId, actor.owner.type, actor.owner.id, actor.sessionVersion, session.role === "admin"]);
  const row = current.rows[0]; if (!row) return null;
  const view = z.enum(["crew_map", "gate_log", "safety", "coverage", "meeting_room"]).nullable().parse(row.current_view);
  if (view && !(row.view_allowlist as string[]).includes(view)) return null;
  const siteId = row.current_site_location_id == null ? null : Number(row.current_site_location_id);
  const meetingId = row.current_meeting_occurrence_id == null ? null : z.uuid().parse(row.current_meeting_occurrence_id);
  if (view && view !== "meeting_room") {
    if (!siteId || !(row.site_allowlist as number[]).includes(siteId)) return null;
    const site = (await pool.query("SELECT partner_id FROM site_locations WHERE id=$1 AND is_active=true AND hidden=false", [siteId])).rows[0];
    if (!site || actor.owner.type === "partner" && site.partner_id !== actor.owner.id) return null;
    if (actor.owner.type === "vendor") {
      const allowed = await pool.query(`SELECT a.id FROM site_work_assignments a JOIN partner_vendor_relationships r ON r.vendor_id=a.vendor_id AND r.partner_id=$3 AND r.status='approved' WHERE a.site_location_id=$1 AND a.vendor_id=$2`, [siteId, actor.owner.id, site.partner_id]);
      if (!allowed.rows.length) return null;
    }
    if (view === "gate_log") await requireChangeOverAccess(pool, session, siteId);
  }
  if (view === "meeting_room") {
    if (!meetingId) return null;
    const allowed = await pool.query(`SELECT o.id FROM work_hub_meeting_occurrences o JOIN work_hub_meetings m ON m.id=o.meeting_id JOIN work_hub_meeting_participants p ON p.occurrence_id=o.id AND p.user_id=$2 WHERE o.id=$1 AND m.owner_org_type=$3 AND m.owner_org_id=$4 AND p.removed_at IS NULL AND o.status NOT IN ('ended','cancelled')`, [meetingId, actor.userId, actor.owner.type, actor.owner.id]);
    if (!allowed.rows.length) return null;
  }
  return { displayId, monitorId, displayName: String(row.name), monitorName: String(row.monitor_name), view, siteLocationId: siteId, meetingOccurrenceId: meetingId, privacyMode: row.privacy_mode === true, configuredAt: date(row.updated_at)! };
}

export async function readDisplayViewRecords(state: OperationsDisplayViewState, session: SessionPayload) {
  if (!state.view) return [];
  if (state.view === "coverage") {
    const actor = displayCommandActor(session);
    const result = await pool.query(`SELECT c.id,s.title,c.state,c.required_count,c.assigned_count,c.actual_count,s.starts_at,s.ends_at
      FROM workforce_coverage_records c JOIN work_hub_shifts s ON s.id=c.shift_id
      WHERE s.owner_org_type=$1 AND s.owner_org_id=$2 AND s.site_location_id=$3 ORDER BY s.starts_at DESC LIMIT 100`, [actor.owner.type, actor.owner.id, state.siteLocationId]);
    return result.rows.map(row => ({ id: String(row.id), title: String(row.title), status: String(row.state), detail: `${row.actual_count} recorded present · ${row.assigned_count} assigned · ${row.required_count} required`, sourceRecordedAt: null }));
  }
  const paths = {
    crew_map: `/live-locations?siteLocationId=${state.siteLocationId}`,
    gate_log: `/visits?siteLocationId=${state.siteLocationId}&limit=100&offset=0`,
    safety: "/implementation-a/safety/incidents",
    meeting_room: `/work-hub/calendar/items/meeting/${state.meetingOccurrenceId}`,
  };
  const response = await callNaturalVoiceDomainApi(paths[state.view], "GET", {}, session);
  const envelope = record(response);
  if (envelope.ok === false || envelope.error) return unavailable();
  if (state.view === "meeting_room") {
    const item = record(envelope.item), meeting = record(item.meeting), occurrence = record(item.occurrence);
    if (occurrence.id !== state.meetingOccurrenceId) return unavailable();
    return [{ id: String(occurrence.id), title: String(meeting.title ?? "Meeting"), status: String(occurrence.status), detail: `${date(occurrence.startsAt) ?? ""} · ${date(occurrence.endsAt) ?? ""}`, sourceRecordedAt: null }];
  }
  const rows = state.view === "crew_map" ? envelope.locations : state.view === "safety" ? envelope.incidents : response;
  if (!Array.isArray(rows)) return unavailable();
  const projected = rows.map(record).filter(row => state.view !== "safety" || row.siteLocationId === state.siteLocationId).slice(0, 100).map(row => {
    if (state.view === "crew_map") return { id: `ticket:${row.ticketId}`, title: state.privacyMode ? `Ticket ${row.ticketId}` : String(row.employeeName), status: String(row.lifecycleState ?? "Unknown"), detail: "Reported phone location", sourceRecordedAt: date(row.recordedAt), latitude: z.number().min(-90).max(90).parse(row.latitude), longitude: z.number().min(-180).max(180).parse(row.longitude) };
    if (state.view === "gate_log") return { id: `visit:${row.id}`, title: state.privacyMode ? `Visit ${row.id}` : `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), status: row.checkOutTime ? (row.autoCheckedOut ? "auto_checked_out" : "checked_out") : row.admissionStatus === "pending" ? "pending_admission" : "checked_in", detail: state.privacyMode ? "Recorded Gate visit" : String(row.vehiclePlate ?? ""), sourceRecordedAt: date(row.checkOutTime ?? row.checkInTime) };
    return { id: String(row.eventId), title: String(row.eventNumber ?? "Incident"), status: String(row.responseStatus), detail: String(row.severity), sourceRecordedAt: date(row.updatedAt) };
  });
  return { records: projected, truncated: rows.length >= 100 };
}
router.get("/implementation-a/operations-display-view", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const session = getSessionFromRequest(req); if (!session) return res.status(401).json({ code: "display_view.unavailable" });
    const actor = displayCommandActor(session);
    const selected = await pool.query("SELECT d.id AS display_id,o.id AS monitor_id FROM operations_displays d JOIN operations_display_outputs o ON o.display_id=d.id WHERE d.registered_by_user_id=$1 AND d.owner_org_type=$2 AND d.owner_org_id=$3 AND d.revoked_at IS NULL ORDER BY d.id,o.id LIMIT 100", [actor.userId, actor.owner.type, actor.owner.id]);
    const monitors = [];
    for (const row of selected.rows) {
      const state = await authorizeDisplayView(session, row.display_id, row.monitor_id);
      if (state) monitors.push({ ...state, href: `/operations-display/${state.displayId}/${state.monitorId}` });
    }
    return res.json({ monitors, truncated: selected.rows.length >= 100 });
  } catch { return res.status(403).json({ code: "display_view.unavailable" }); }
});
router.get("/implementation-a/operations-display-view/:displayId/:monitorId", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const session = getSessionFromRequest(req); if (!session) return res.status(401).json({ code: "display_view.unavailable" });
    const displayId = z.uuid().parse(req.params.displayId), monitorId = z.uuid().parse(req.params.monitorId);
    const viewer = createOperationsDisplayViewer({ authorize: (display, monitor) => authorizeDisplayView(session, display, monitor), read: state => readDisplayViewRecords(state, session), now: () => new Date() });
    return res.json(await viewer.read(displayId, monitorId));
  } catch { return res.status(403).json({ code: "display_view.unavailable" }); }
});
export default router;
