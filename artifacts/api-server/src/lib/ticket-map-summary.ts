import { pool } from "@workspace/db";
import { estimateMapboxDrivingRoute } from "./mapbox-routing";

type Visit = { employeeId: number; checkInAt: string | null; checkOutAt: string | null };
export function ticketWorkerTotals(people: Visit[], finished: boolean, finishedAt: string | null, now = Date.now()) {
  const intervals = new Map<number, Array<[number, number]>>();
  const active = new Set<number>();
  for (const person of people) {
    if (!person.checkInAt) continue;
    const start = Date.parse(person.checkInAt);
    const end = person.checkOutAt ? Date.parse(person.checkOutAt) : finished ? (finishedAt ? Date.parse(finishedAt) : start) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > now) continue;
    if (!finished && !person.checkOutAt) active.add(person.employeeId);
    const rows = intervals.get(person.employeeId) ?? [];
    rows.push([start, Math.max(start, Math.min(end, now))]);
    intervals.set(person.employeeId, rows);
  }
  let duration = 0;
  for (const rows of intervals.values()) {
    rows.sort((a, b) => a[0] - b[0]);
    let start = rows[0]![0], end = rows[0]![1];
    for (const next of rows.slice(1)) {
      if (next[0] <= end) end = Math.max(end, next[1]);
      else { duration += end - start; [start, end] = next; }
    }
    duration += end - start;
  }
  return { peopleCount: intervals.size, onSiteCount: active.size, totalOnSiteMinutes: Math.round(duration / 60000) };
}

export type TicketMapLocation = { id: string; name: string; latitude: number; longitude: number; recordedAt: string; source: string };
type Observation = { latitude?: number; longitude?: number; observedAt?: string; source?: string };
export function equipmentTicketLocation(profile: any, ticketId: number, cutoff: string | null): Observation | null {
  let associated: number | null = null, location: Observation | null = null;
  const limit = cutoff ? Date.parse(cutoff) : Infinity;
  for (const event of [...(profile?.history ?? [])].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))) {
    if (Date.parse(event.occurredAt) > limit) continue;
    if (Object.prototype.hasOwnProperty.call(event, "ticketId")) associated = event.ticketId;
    if (associated === ticketId && event.location && Date.parse(event.location.observedAt) <= limit) location = event.location;
  }
  if (!cutoff && profile?.ticketId === ticketId && profile.location) location = profile.location;
  return location;
}

/** Caller must first authorize access to this ticket. Never read company-wide live positions. */
export async function ticketMapContext(ticketId: number, vendorId: number, site: { latitude: number; longitude: number } | null, cutoff: string | null) {
  const [company, yards, assets] = await Promise.all([
    pool.query("SELECT name,latitude,longitude,fleet_commercial_settings FROM vendors WHERE id=$1", [vendorId]),
    pool.query("SELECT name,destination_id FROM fleet_yards WHERE company_id=$1 AND active AND is_home_base ORDER BY id LIMIT 1", [vendorId]),
    pool.query(`SELECT id,name,equipment_profile FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=$1
      AND (equipment_profile->>'ticketId'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(equipment_profile->'history','[]'::jsonb)) h WHERE h->>'ticketId'=$2))`, [vendorId, String(ticketId)]),
  ]);
  const vendor = company.rows[0], yard = yards.rows[0];
  const destination = vendor?.fleet_commercial_settings?.destinations?.find((d: any) => d.id === yard?.destination_id && d.active);
  const origin = destination?.latitude != null && destination?.longitude != null
    ? { name: yard.name, latitude: Number(destination.latitude), longitude: Number(destination.longitude) }
    : vendor?.latitude != null && vendor?.longitude != null ? { name: vendor.name, latitude: Number(vendor.latitude), longitude: Number(vendor.longitude) } : null;
  const estimate = origin && site ? await estimateMapboxDrivingRoute({ origin, destination: site }) : null;
  const equipment: TicketMapLocation[] = assets.rows.flatMap(row => {
    const location = equipmentTicketLocation(row.equipment_profile, ticketId, cutoff);
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || !location.observedAt) return [];
    return [{ id: row.id, name: row.name, latitude: location.latitude!, longitude: location.longitude!, recordedAt: location.observedAt, source: location.source ?? "recorded" }];
  });
  // Fleet vehicle observations retain their run and device provenance. Only runs
  // explicitly billed to this ticket qualify; a company's other vehicles do not.
  const fleet = await pool.query(`WITH runs AS (
    SELECT DISTINCT ON (id) id,run FROM (
      SELECT target_id id,tool_output run,a.id ordering FROM assistant_action_audit a
      WHERE vendor_id=$1 AND target_type='fleet-run'
      UNION ALL SELECT r->>'id',r,0 FROM vendors v,jsonb_array_elements(COALESCE(v.fleet_ops_state->'runs','[]'::jsonb)) r WHERE v.id=$1
    ) saved ORDER BY id,ordering DESC
  ), scoped AS (SELECT id,run FROM runs WHERE run->>'linkedTicketId'=$2 OR run->'billingV2'->>'ticketId'=$2)
  SELECT DISTINCT ON (a.target_id) a.target_id, a.tool_output->'observation' observation, asset.name
  FROM assistant_action_audit a JOIN scoped r ON r.id=a.target_id
  LEFT JOIN assets asset ON asset.id::text=a.tool_output->'observation'->>'vehicleAssetId' AND asset.responsible_org_id=$1 AND asset.responsible_org_type='vendor'
  WHERE a.vendor_id=$1 AND a.target_type='fleet-location'
    AND ($3::timestamptz IS NULL OR (a.tool_output->'observation'->>'recordedAt')::timestamptz <= $3::timestamptz)
    AND EXISTS(SELECT 1 FROM location_consents c WHERE c.user_id=(a.tool_output->'observation'->>'driverUserId')::int AND c.device_id=a.tool_output->>'deviceId' AND c.revoked_at IS NULL)
  ORDER BY a.target_id,(a.tool_output->'observation'->>'recordedAt')::timestamptz DESC,a.id DESC`, [vendorId, String(ticketId), cutoff]);
  for (const row of fleet.rows) {
    const p = row.observation;
    if (typeof p?.latitude !== "number" || typeof p?.longitude !== "number" || !p.recordedAt) continue;
    equipment.push({ id: `fleet:${row.target_id}`, name: row.name ?? "Fleet vehicle", latitude: p.latitude, longitude: p.longitude, recordedAt: p.recordedAt, source: "fleet_driver_phone" });
  }
  return { equipment, roadDistance: { originName: origin?.name ?? null, miles: estimate?.ok ? estimate.distanceMiles : null,
    reason: !origin ? "missing_origin" : !site ? "missing_site" : estimate?.ok ? null : "route_unavailable" } };
}
