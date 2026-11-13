import { sql } from "drizzle-orm";
import { db, vendorPeopleTable } from "@workspace/db";

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
