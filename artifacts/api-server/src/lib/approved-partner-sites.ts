import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db, partnerVendorRelationshipsTable, ACTIVE_APPROVAL_STATUSES, siteLocationsTable, siteWorkAssignmentsTable, ticketsTable, ticketCrewTable } from "@workspace/db";
import { acceptedMarketplaceSites, hasAcceptedMarketplaceAccess } from "./accepted-marketplace-access";

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

function sitesAssignedToVendor(vendorId: number, gateOnly: boolean) {
  return db.select({ siteLocationId: siteWorkAssignmentsTable.siteLocationId })
    .from(siteWorkAssignmentsTable)
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, vendorId),
      gateOnly ? eq(siteWorkAssignmentsTable.isGateContractor, true) : undefined,
    ));
}

export function vendorOperationalSiteScope(vendorId: number) {
  const ticketSites = db.select({ siteLocationId: ticketsTable.siteLocationId })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.vendorId, vendorId), notInArray(ticketsTable.status, ["cancelled", "denied"])));

  // A Gate assignment must be visible before Assume Watch can open its first ticket.
  return or(
    and(
      inArray(siteLocationsTable.partnerId, approvedPartnersForVendor(vendorId)),
      or(inArray(siteLocationsTable.id, ticketSites), inArray(siteLocationsTable.id, sitesAssignedToVendor(vendorId, true))),
    ),
    inArray(siteLocationsTable.id, acceptedMarketplaceSites(vendorId)),
  )!;
}

export function vendorTicketCreationSiteScope(vendorId: number) {
  return and(
    eq(siteLocationsTable.hidden, false),
    eq(siteLocationsTable.isActive, true),
    inArray(siteLocationsTable.id, sitesAssignedToVendor(vendorId, false)),
    or(
      inArray(siteLocationsTable.partnerId, approvedPartnersForVendor(vendorId)),
      inArray(siteLocationsTable.id, acceptedMarketplaceSites(vendorId)),
    ),
  )!;
}

export async function vendorCanReadSite(vendorId: number, siteId: number, forTicketCreation = false) {
  const scope = forTicketCreation
    ? or(vendorOperationalSiteScope(vendorId), vendorTicketCreationSiteScope(vendorId))
    : vendorOperationalSiteScope(vendorId);
  const [site] = await db.select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(and(eq(siteLocationsTable.id, siteId), scope))
    .limit(1);
  return !!site;
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
  if (!(await vendorCanReadPartner(vendorId, partnerId))) return hasAcceptedMarketplaceAccess(vendorId, { siteId, employeeId });
  const rows = await sitesAssignedToEmployee(employeeId, vendorId, siteId);
  return rows.length > 0;
}
