import { sql } from "drizzle-orm";
import { jobOfferAcceptanceSnapshotsTable as snapshots, jobOffersTable as offers, ticketsTable as tickets, siteWorkAssignmentsTable as assignments } from "@workspace/db/schema";

/** Canonical ticket list/detail AFE. An accepted absence is also immutable. */
export const ticketAfeSql = sql<string | null>`CASE
  WHEN ${tickets.submissionRevision} > 0 THEN ${tickets.proofSubmissions}->-1->>'afe'
  WHEN COALESCE(${tickets.engagementJobOfferId}, ${tickets.jobOfferId}) IS NOT NULL THEN (
    SELECT ${snapshots.scopeSnapshot}->>'afeCode'
    FROM ${snapshots} INNER JOIN ${offers} ON ${offers.id}=${snapshots.jobOfferId}
    WHERE ${offers.id}=COALESCE(${tickets.engagementJobOfferId}, ${tickets.jobOfferId})
      AND (${tickets.engagementJobOfferId} IS NOT NULL OR ${offers.createdTicketId}=${tickets.id})
      AND ${offers.vendorId}=${tickets.vendorId}
      AND ${offers.siteLocationId}=${tickets.siteLocationId}
      AND ${offers.workTypeId}=${tickets.workTypeId}
      AND ${offers.status}='accepted'
  )
  WHEN ${tickets.fleetPlan}->>'billingWorkflow'='true' THEN ${tickets.fleetPlan}->>'afeNumber'
  ELSE ${assignments.afe}
END`;
