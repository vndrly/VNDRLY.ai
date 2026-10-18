import { sql } from "drizzle-orm";
import { jobOfferAcceptanceSnapshotsTable as snapshots, jobOffersTable as offers, ticketsTable as tickets, siteWorkAssignmentsTable as assignments } from "@workspace/db/schema";

/** Canonical ticket list/detail AFE. An accepted absence is also immutable. */
export const ticketAfeSql = sql<string | null>`CASE
  WHEN ${tickets.jobOfferId} IS NOT NULL THEN (
    SELECT ${snapshots.scopeSnapshot}->>'afeCode'
    FROM ${snapshots} INNER JOIN ${offers} ON ${offers.id}=${snapshots.jobOfferId}
    WHERE ${offers.id}=${tickets.jobOfferId}
      AND ${offers.createdTicketId}=${tickets.id}
      AND ${offers.vendorId}=${tickets.vendorId}
      AND ${offers.status}='accepted'
  )
  WHEN ${tickets.fleetPlan}->>'billingWorkflow'='true' THEN ${tickets.fleetPlan}->>'afeNumber'
  ELSE ${assignments.afe}
END`;
