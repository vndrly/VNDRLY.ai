import { and, eq, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  jobOffersTable as offers,
  ticketsTable as tickets,
  siteLocationsTable as sites,
  ticketCrewTable as crew,
} from "@workspace/db/schema";

/** An accepted engagement grants only its exact ticket/site, never the partner's whole catalog. */
export function acceptedMarketplaceSites(
  vendorId: number,
  scope: {
    siteId?: number;
    ticketId?: number;
    workTypeId?: number;
    employeeId?: number;
  } = {},
) {
  return db
    .select({ siteLocationId: tickets.siteLocationId })
    .from(tickets)
    .innerJoin(
      offers,
      and(
        eq(offers.id, tickets.jobOfferId),
        eq(offers.createdTicketId, tickets.id),
        eq(offers.status, "accepted"),
        eq(offers.vendorId, tickets.vendorId),
        eq(offers.siteLocationId, tickets.siteLocationId),
        eq(offers.workTypeId, tickets.workTypeId),
      ),
    )
    .innerJoin(
      sites,
      and(
        eq(sites.id, tickets.siteLocationId),
        eq(sites.partnerId, offers.partnerId),
      ),
    )
    .leftJoin(
      crew,
      and(
        eq(crew.ticketId, tickets.id),
        eq(crew.employeeId, scope.employeeId ?? -1),
        isNull(crew.removedAt),
        notInArray(crew.ackStatus, ["declined", "rejected"]),
      ),
    )
    .where(
      and(
        eq(tickets.vendorId, vendorId),
        notInArray(tickets.status, ["cancelled", "denied"]),
        scope.siteId == null
          ? undefined
          : eq(tickets.siteLocationId, scope.siteId),
        scope.ticketId == null ? undefined : eq(tickets.id, scope.ticketId),
        scope.workTypeId == null
          ? undefined
          : eq(tickets.workTypeId, scope.workTypeId),
        scope.employeeId == null
          ? undefined
          : or(
              eq(tickets.fieldEmployeeId, scope.employeeId),
              eq(crew.employeeId, scope.employeeId),
            ),
      ),
    );
}

export async function hasAcceptedMarketplaceAccess(
  vendorId: number,
  scope: Parameters<typeof acceptedMarketplaceSites>[1],
) {
  return (await acceptedMarketplaceSites(vendorId, scope).limit(1)).length > 0;
}
