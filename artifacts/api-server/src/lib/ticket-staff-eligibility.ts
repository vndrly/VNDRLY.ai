import { sql } from "drizzle-orm";
import { db, vendorPeopleTable, ticketsTable } from "@workspace/db";

export async function ticketStaffContext(ticketId: number) {
  const row = (await db.execute(sql`SELECT t.vendor_id AS "vendorId", t.site_location_id AS "siteId",
    (lower(w.name)='gatekeeping' OR lower(w.category)='gate') AS "isGate"
    FROM tickets t JOIN work_types w ON w.id=t.work_type_id WHERE t.id=${ticketId}`)).rows[0];
  return row as {vendorId:number;siteId:number;isGate:boolean} | undefined;
}

/** Match the gate roster's active role and explicit site-access rules. */
export function eligibleGateEmployeeCondition(vendorId: number, siteId: number) {
  return sql`${vendorPeopleTable.vendorId}=${vendorId} AND ${vendorPeopleTable.isActive}=true
    AND ${vendorPeopleTable.deletedAt} IS NULL
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=${vendorPeopleTable.userId} AND u.suspended_at IS NULL)
    AND EXISTS(SELECT 1 FROM vendor_person_site_access a WHERE a.vendor_people_id=${vendorPeopleTable.id}
      AND a.site_location_id=${siteId} AND a.is_active=true)
    AND (EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=${vendorPeopleTable.id}
      AND r.is_active=true AND r.role IN ('gatekeeper','gate_supervisor'))
      OR (NOT EXISTS(SELECT 1 FROM vendor_person_operational_roles r WHERE r.vendor_people_id=${vendorPeopleTable.id})
        AND ${vendorPeopleTable.vendorRole} IN ('gatekeeper','gate_supervisor')))`;
}

/** Managed staff retain their user identity; they are not duplicate direct employees. */
export async function eligibleManagedGateEmployees(vendorId: number, siteId: number) {
  const result = await db.execute(sql`SELECT DISTINCT u.id AS "userId", u.display_name AS name
    FROM managed_subcontractor_worker_sponsorships s
    JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=s.id
    JOIN managed_subcontractor_sponsors sponsor ON sponsor.managed_organization_id=s.managed_organization_id AND sponsor.sponsor_vendor_id=s.sponsor_vendor_id
    JOIN users u ON u.id=s.worker_user_id
    WHERE s.sponsor_vendor_id=${vendorId} AND s.status='active' AND sponsor.status='active'
      AND g.status='active' AND g.site_id=${siteId} AND g.role IN ('gatekeeper','gate_supervisor')
      AND u.suspended_at IS NULL ORDER BY u.display_name`);
  return result.rows as { userId: number; name: string }[];
}

export function managedGateTicketCondition(userId: number, vendorId: number) {
  return sql`${ticketsTable.gateEmployeeUserId}=${userId} AND ${ticketsTable.vendorId}=${vendorId}
    AND EXISTS (SELECT 1 FROM managed_subcontractor_worker_sponsorships s
      JOIN managed_subcontractor_role_grants g ON g.sponsorship_id=s.id
      JOIN managed_subcontractor_sponsors sponsor ON sponsor.managed_organization_id=s.managed_organization_id AND sponsor.sponsor_vendor_id=s.sponsor_vendor_id
      JOIN users u ON u.id=s.worker_user_id
      WHERE s.worker_user_id=${userId} AND s.sponsor_vendor_id=${vendorId} AND s.status='active'
      AND sponsor.status='active' AND u.suspended_at IS NULL AND g.status='active'
      AND g.site_id=${ticketsTable.siteLocationId} AND g.role IN ('gatekeeper','gate_supervisor'))`;
}
