import { pool } from "@workspace/db";
import type { GateWatchTimeline } from "@workspace/gate-booth";
import type { SessionPayload } from "../lib/session";
import { listChangeOverSites } from "./gate-change-over";

/** One completed watch and the earliest future scheduled watch per authorized site. */
export async function listGateWatchTimeline(session: SessionPayload, at = new Date()): Promise<GateWatchTimeline> {
  const sites = await listChangeOverSites(session);
  if (!sites.length) return { radar: [], sites: [] };
  const args = [sites.map(site => site.id), session.vendorId ?? null, at];
  const [completed, scheduled, radar] = await Promise.all([
    pool.query(`SELECT DISTINCT ON (g.site_id) g.site_id,w.id AS watch_id,w.station_id,g.name AS gate_name,
      w.operator_id,coalesce(u.display_name,u.username) AS name,w.started_at,w.ended_at,
      p.notes,p.created_at AS filed_at,p.handoff_id
      FROM gate_shifts w JOIN gate_stations g ON g.id=w.station_id JOIN users u ON u.id=w.operator_id
      LEFT JOIN LATERAL (
        SELECT prep.notes,prep.created_at,h.id AS handoff_id FROM gate_preparations prep
        LEFT JOIN gate_handovers h ON h.preparation_id=prep.id
        WHERE prep.shift_id=w.id AND (prep.id=w.preparation_id OR h.id IS NOT NULL)
        ORDER BY prep.created_at DESC,prep.id DESC LIMIT 1
      ) p ON true
      WHERE g.site_id=ANY($1::int[]) AND w.ended_at IS NOT NULL AND w.ended_at<=$3
        AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM user_org_memberships m
          WHERE m.user_id=w.operator_id AND m.org_type='vendor' AND m.vendor_id=$2))
      ORDER BY g.site_id,w.ended_at DESC,w.started_at DESC,w.id DESC`, args),
    pool.query(`WITH upcoming AS (
      SELECT DISTINCT ON (g.site_id) g.site_id,s.id,s.gate_station_id,g.name AS gate_name,
        s.starts_at,s.ends_at,s.timezone,s.owner_org_type,s.owner_org_id
      FROM work_hub_shifts s JOIN gate_stations g ON g.id=s.gate_station_id AND g.site_id=s.site_location_id
      WHERE g.site_id=ANY($1::int[]) AND g.active=true AND s.starts_at>$3 AND s.ends_at>s.starts_at
        AND s.milestone_status NOT IN ('cancelled','completed')
        AND ($2::int IS NULL OR (s.owner_org_type='vendor' AND s.owner_org_id=$2))
      ORDER BY g.site_id,s.starts_at,s.id
    ) SELECT upcoming.*,coalesce(people.members,'[]'::jsonb) AS people FROM upcoming
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('userId',u.id,'name',coalesce(u.display_name,u.username))
          ORDER BY coalesce(u.display_name,u.username),u.id) AS members
        FROM work_hub_shift_assignments a JOIN users u ON u.id=a.user_id AND u.suspended_at IS NULL
        WHERE a.shift_id=upcoming.id AND a.status IN ('assigned','accepted','claimed')
          AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=u.id AND m.org_type=upcoming.owner_org_type
            AND ((m.org_type='vendor' AND m.vendor_id=upcoming.owner_org_id)
              OR (m.org_type='partner' AND m.partner_id=upcoming.owner_org_id)))
      ) people ON true`, args),
    pool.query(`SELECT s.id AS shift_id,g.site_id,s.gate_station_id AS station_id,g.name AS gate_name,
      s.title,s.starts_at,s.ends_at,s.timezone
      FROM work_hub_shifts s JOIN gate_stations g ON g.id=s.gate_station_id AND g.site_id=s.site_location_id
      WHERE g.site_id=ANY($1::int[]) AND g.active=true
        AND s.starts_at>$3 AND s.starts_at<=$3 + interval '24 hours' AND s.ends_at>s.starts_at
        AND s.milestone_status NOT IN ('cancelled','completed')
        AND ($2::int IS NULL OR (s.owner_org_type='vendor' AND s.owner_org_id=$2))
        AND NOT EXISTS(SELECT 1 FROM work_hub_shift_assignments a
          WHERE a.shift_id=s.id AND a.status IN ('assigned','accepted','claimed'))
      ORDER BY s.starts_at,s.id`, args),
  ]);
  const previousBySite = new Map(completed.rows.map(row => [row.site_id, row]));
  const nextBySite = new Map(scheduled.rows.map(row => [row.site_id, row]));
  const siteNames = new Map(sites.map(site => [site.id, site.name]));
  return { radar: radar.rows.map(row => ({
    shiftId: row.shift_id,
    siteId: Number(row.site_id),
    siteName: siteNames.get(Number(row.site_id)) ?? "",
    stationId: row.station_id,
    gateName: row.gate_name,
    title: row.title,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    timezone: row.timezone,
  })), sites: sites.map(site => {
    const previous = previousBySite.get(site.id), next = nextBySite.get(site.id);
    return {
      siteId: site.id, siteName: site.name,
      previous: previous ? {
        watchId: previous.watch_id, stationId: previous.station_id, gateName: previous.gate_name,
        userId: previous.operator_id, name: previous.name,
        startedAt: new Date(previous.started_at).toISOString(), endedAt: new Date(previous.ended_at).toISOString(),
        notes: previous.notes ?? null, filedAt: previous.filed_at ? new Date(previous.filed_at).toISOString() : null,
        handoffId: previous.handoff_id ?? null,
      } : null,
      next: next ? {
        shiftId: next.id, stationId: next.gate_station_id, gateName: next.gate_name,
        startsAt: new Date(next.starts_at).toISOString(), endsAt: new Date(next.ends_at).toISOString(),
        timezone: next.timezone, people: next.people,
      } : null,
    };
  }) };
}
