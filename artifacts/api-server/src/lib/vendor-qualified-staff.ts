import { and, eq, exists, inArray, isNull, not, or } from "drizzle-orm";
import { db, vendorPeopleTable, vendorPersonOperationalRolesTable } from "@workspace/db";

/** Current operational grants take precedence over the legacy role projection. */
export function qualifiedVendorStaffCondition(vendorId: number) {
  const activeGrants = db.select({ id: vendorPersonOperationalRolesTable.id })
    .from(vendorPersonOperationalRolesTable).where(and(
      eq(vendorPersonOperationalRolesTable.vendorPeopleId, vendorPeopleTable.id),
      eq(vendorPersonOperationalRolesTable.isActive, true),
    ));
  const operationalStaff = db.select({ id: vendorPersonOperationalRolesTable.id })
    .from(vendorPersonOperationalRolesTable).where(and(
      eq(vendorPersonOperationalRolesTable.vendorPeopleId, vendorPeopleTable.id),
      eq(vendorPersonOperationalRolesTable.isActive, true),
      inArray(vendorPersonOperationalRolesTable.role, ["field_employee", "foreman", "gatekeeper", "gate_supervisor"]),
    ));
  return and(
    eq(vendorPeopleTable.vendorId, vendorId),
    eq(vendorPeopleTable.isActive, true),
    isNull(vendorPeopleTable.deletedAt),
    or(
      eq(vendorPeopleTable.vendorRole, "admin"),
      exists(operationalStaff),
      and(not(exists(activeGrants)), inArray(vendorPeopleTable.vendorRole,
        ["field", "field_employee", "both", "foreman", "gatekeeper", "gate_supervisor"])),
    ),
  );
}
