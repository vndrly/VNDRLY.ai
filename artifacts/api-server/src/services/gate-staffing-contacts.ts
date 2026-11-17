import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, requireGateStationManagementAccess } from "./gate-change-over";
import { workforceOnCall } from "./workforce-roster";

/** Contact priority, not assignment permission. No calendar, rest or duty filtering. */
export async function readGateStaffingContacts(session: SessionPayload, alertId: string,
  client: Pick<typeof pool, "query"> = pool, authorize = requireGateStationManagementAccess) {
  if (!session.userId || !session.vendorId) throw new ChangeOverError(403, "staffing_contacts.company_required", "Current vendor company required");
  const alert = (await client.query(
    "SELECT site_id FROM gate_staffing_alerts WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND resolved_at IS NULL",
    [alertId, session.vendorId],
  )).rows[0];
  if (!alert) throw new ChangeOverError(404, "staffing_contacts.not_found", "Staffing alert not found");
  await authorize(client, session, Number(alert.site_id));
  const rows = (await client.query(`SELECT DISTINCT ON(u.id) u.id AS user_id,
    COALESCE(NULLIF(trim(concat_ws(' ',p.first_name,p.last_name)),''),u.display_name) AS name,
    p.phone,u.email,d.native_operations
    FROM vendor_people p JOIN users u ON u.id=p.user_id
    JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=p.vendor_id AND m.org_type='vendor'
    LEFT JOIN work_hub_device_preferences d ON d.user_id=u.id AND d.owner_org_type='vendor' AND d.owner_org_id=p.vendor_id
    WHERE p.vendor_id=$1 AND p.is_active=true AND p.deleted_at IS NULL AND u.suspended_at IS NULL
    AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
      OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=p.id) AND p.vendor_role IN ('gatekeeper','gate_supervisor')))
    ORDER BY u.id,p.id`, [session.vendorId])).rows;
  const now = new Date();
  const people = rows.map(row => ({
    userId: Number(row.user_id), name: String(row.name), phone: row.phone as string | null,
    email: row.email as string | null, pickupShifts: row.native_operations?.pickupShifts === true,
    onCall: workforceOnCall(row.native_operations ?? {}, now) === "active",
  })).sort((a,b) => Number(b.pickupShifts)-Number(a.pickupShifts) || a.name.localeCompare(b.name) || a.userId-b.userId);
  return { people };
}
