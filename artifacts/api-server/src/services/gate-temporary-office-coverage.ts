import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";

type Client = Pick<PoolClient, "query">;
export type TemporaryOfficeGateWatch = {
  stationId: string;
  siteId: number;
  watchId: string;
};

/** A saved personal watch grants Gate custody; it never changes company roles. */
export async function loadTemporaryOfficeGateWatches(
  client: Client,
  session: SessionPayload,
): Promise<TemporaryOfficeGateWatch[]> {
  if (
    !session.userId ||
    !session.vendorId ||
    !session.activeMembershipId ||
    session.managedSubcontractor ||
    !["vendor", "field_employee"].includes(session.role ?? "")
  )
    return [];
  return (
    await client.query(
      `SELECT DISTINCT d.station_id AS "stationId",g.site_id AS "siteId",w.id AS "watchId"
    FROM users u JOIN user_org_memberships m ON m.id=u.active_membership_id AND m.user_id=u.id
    JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id
    JOIN gate_duty_sessions d ON d.user_id=u.id AND d.ended_at IS NULL
      AND d.post_coverage->>'vendorId'=m.vendor_id::text
      AND d.post_coverage->>'temporaryOfficeCoverage'='true'
      AND d.post_coverage->>'assigneeAcknowledged' IS DISTINCT FROM 'false'
    JOIN gate_shifts w ON w.station_id=d.station_id AND w.operator_id=u.id AND w.ended_at IS NULL
    JOIN gate_stations g ON g.id=d.station_id
    JOIN site_locations site ON site.id=g.site_id AND site.hidden IS DISTINCT FROM true
    WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3
      AND m.org_type='vendor' AND m.vendor_id=$4 AND p.deleted_at IS NULL AND p.is_active=true
      AND (p.vendor_role IN ('office','both') OR EXISTS(SELECT 1 FROM vendor_person_operational_roles r
        WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role='office'))
      AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=g.site_id AND a.vendor_id=m.vendor_id AND a.is_gate_contractor=true)
    ORDER BY d.station_id`,
      [
        session.userId,
        session.sv,
        session.activeMembershipId,
        session.vendorId,
      ],
    )
  ).rows;
}
