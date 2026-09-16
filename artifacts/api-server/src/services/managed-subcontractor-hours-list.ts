import { and, eq } from "drizzle-orm";
import { db, managedSubcontractorOrganizationsTable, managedSubcontractorSponsorsTable, managedSubcontractorWorkerSponsorshipsTable } from "@workspace/db";

export async function listManagedSubcontractorHoursOrganizations(input: { userId: number; vendorId: number; managedWorker: boolean }) {
  const query = db.selectDistinct({ id: managedSubcontractorOrganizationsTable.id, name: managedSubcontractorOrganizationsTable.name })
    .from(managedSubcontractorOrganizationsTable)
    .innerJoin(managedSubcontractorSponsorsTable, eq(managedSubcontractorSponsorsTable.managedOrganizationId, managedSubcontractorOrganizationsTable.id))
    .leftJoin(managedSubcontractorWorkerSponsorshipsTable, and(
      eq(managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId, managedSubcontractorOrganizationsTable.id),
      eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, input.userId),
      eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
    ))
    .where(and(
      eq(managedSubcontractorSponsorsTable.sponsorVendorId, input.vendorId),
      eq(managedSubcontractorSponsorsTable.status, "active"),
      input.managedWorker ? eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, input.userId) : undefined,
    ))
    .orderBy(managedSubcontractorOrganizationsTable.name);
  return { items: await query };
}
