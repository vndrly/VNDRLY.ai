import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db, partnerVendorRelationshipsTable, ACTIVE_APPROVAL_STATUSES, ticketsTable, ticketCrewTable } from "@workspace/db";

export function approvedPartnersForVendor(vendorId: number) {
  return db.select({ partnerId: partnerVendorRelationshipsTable.partnerId })
    .from(partnerVendorRelationshipsTable)
    .where(and(eq(partnerVendorRelationshipsTable.vendorId, vendorId), inArray(partnerVendorRelationshipsTable.status, ACTIVE_APPROVAL_STATUSES)));
}

export async function vendorCanReadPartner(vendorId: number, partnerId: number | null) {
  if (partnerId == null) return false;
  const rows = await approvedPartnersForVendor(vendorId);
  return rows.some((row) => row.partnerId === partnerId);
}

// Vendor-wide work assignments have no employee identity. Only an employee's
// own ticket or unremoved crew assignment can grant private field site access.
export function sitesAssignedToEmployee(employeeId: number, vendorId: number, siteId?: number) {
  return db.select({ siteLocationId: ticketsTable.siteLocationId }).from(ticketsTable)
    .leftJoin(ticketCrewTable, and(eq(ticketCrewTable.ticketId, ticketsTable.id), eq(ticketCrewTable.employeeId, employeeId), isNull(ticketCrewTable.removedAt), notInArray(ticketCrewTable.ackStatus, ["declined", "rejected"])))
    .where(and(
      eq(ticketsTable.vendorId, vendorId),
      notInArray(ticketsTable.status, ["cancelled", "denied"]),
      or(eq(ticketsTable.fieldEmployeeId, employeeId), eq(ticketCrewTable.employeeId, employeeId)),
      siteId == null ? undefined : eq(ticketsTable.siteLocationId, siteId),
    ));
}

export async function employeeCanReadSite(employeeId: number, vendorId: number, partnerId: number | null, siteId: number) {
  if (!(await vendorCanReadPartner(vendorId, partnerId))) return false;
  const rows = await sitesAssignedToEmployee(employeeId, vendorId, siteId);
  return rows.length > 0;
}
