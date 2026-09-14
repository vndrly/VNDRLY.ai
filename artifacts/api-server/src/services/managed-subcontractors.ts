import { and, eq } from "drizzle-orm";
import {
  db,
  managedSubcontractorClaimsTable,
  managedSubcontractorOrganizationsTable,
  managedSubcontractorRoleGrantsTable,
  managedSubcontractorSponsorsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  userOrgMembershipsTable,
  usersTable,
} from "@workspace/db";
import type {
  GrantSponsoredRoleInput,
  ManagedSubcontractorRole,
} from "@workspace/api-zod";

export class ManagedSubcontractorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface ManagedSubcontractorActor {
  userId: number;
  vendorId: number;
}

function canonicalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

async function assertVendorAdmin(actor: ManagedSubcontractorActor): Promise<void> {
  const [membership] = await db
    .select({ id: userOrgMembershipsTable.id })
    .from(userOrgMembershipsTable)
    .where(
      and(
        eq(userOrgMembershipsTable.userId, actor.userId),
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, actor.vendorId),
        eq(userOrgMembershipsTable.role, "admin"),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new ManagedSubcontractorError(
      "Vendor administrator access required",
      403,
      "managed_subcontractor.vendor_admin_required",
    );
  }
}

async function assertActiveSponsor(
  actor: ManagedSubcontractorActor,
  managedOrganizationId: string,
): Promise<void> {
  await assertVendorAdmin(actor);
  const [sponsor] = await db
    .select({ id: managedSubcontractorSponsorsTable.id })
    .from(managedSubcontractorSponsorsTable)
    .where(
      and(
        eq(managedSubcontractorSponsorsTable.managedOrganizationId, managedOrganizationId),
        eq(managedSubcontractorSponsorsTable.sponsorVendorId, actor.vendorId),
        eq(managedSubcontractorSponsorsTable.status, "active"),
      ),
    )
    .limit(1);
  if (!sponsor) {
    throw new ManagedSubcontractorError(
      "Managed organization not found",
      404,
      "managed_subcontractor.not_found",
    );
  }
}

export async function createManagedOrganization(
  actor: ManagedSubcontractorActor,
  input: { name: string },
) {
  await assertVendorAdmin(actor);
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(managedSubcontractorOrganizationsTable)
      .values({
        name: input.name.trim(),
        canonicalName: canonicalizeName(input.name),
        createdByVendorId: actor.vendorId,
        createdByUserId: actor.userId,
      })
      .returning();
    if (!organization) throw new Error("Managed organization insert returned no row");
    await tx.insert(managedSubcontractorSponsorsTable).values({
      managedOrganizationId: organization.id,
      sponsorVendorId: actor.vendorId,
      createdByUserId: actor.userId,
    });
    return organization;
  });
}

export async function inviteManagedWorker(
  actor: ManagedSubcontractorActor,
  managedOrganizationId: string,
  workerUserId: number,
) {
  await assertActiveSponsor(actor, managedOrganizationId);
  const [worker] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, workerUserId))
    .limit(1);
  if (!worker) {
    throw new ManagedSubcontractorError(
      "Worker not found",
      404,
      "managed_subcontractor.worker_not_found",
    );
  }
  const [existing] = await db
    .select()
    .from(managedSubcontractorWorkerSponsorshipsTable)
    .where(
      and(
        eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, workerUserId),
        eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, actor.vendorId),
        eq(
          managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId,
          managedOrganizationId,
        ),
        eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(managedSubcontractorWorkerSponsorshipsTable)
    .values({
      workerUserId,
      sponsorVendorId: actor.vendorId,
      managedOrganizationId,
      invitedByUserId: actor.userId,
    })
    .returning();
  if (!created) throw new Error("Worker sponsorship insert returned no row");
  return created;
}

export async function grantSponsoredRole(
  actor: ManagedSubcontractorActor,
  sponsorshipId: string,
  input: GrantSponsoredRoleInput,
) {
  await assertVendorAdmin(actor);
  const [sponsorship] = await db
    .select()
    .from(managedSubcontractorWorkerSponsorshipsTable)
    .where(
      and(
        eq(managedSubcontractorWorkerSponsorshipsTable.id, sponsorshipId),
        eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, actor.vendorId),
        eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
      ),
    )
    .limit(1);
  if (!sponsorship) {
    throw new ManagedSubcontractorError(
      "Sponsorship not found",
      404,
      "managed_subcontractor.sponsorship_not_found",
    );
  }
  const [grant] = await db
    .insert(managedSubcontractorRoleGrantsTable)
    .values({
      sponsorshipId,
      role: input.role as ManagedSubcontractorRole,
      siteId: input.siteId,
      crewId: input.crewId,
      grantedByUserId: actor.userId,
    })
    .returning();
  if (!grant) throw new Error("Role grant insert returned no row");
  return grant;
}

export async function listVisibleSponsorships(
  actor: ManagedSubcontractorActor,
  workerUserId?: number,
) {
  await assertVendorAdmin(actor);
  const conditions = [
    eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, actor.vendorId),
  ];
  if (workerUserId !== undefined) {
    conditions.push(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, workerUserId));
  }
  return db
    .select()
    .from(managedSubcontractorWorkerSponsorshipsTable)
    .where(and(...conditions));
}

export async function claimManagedOrganization(
  actor: ManagedSubcontractorActor,
  managedOrganizationId: string,
  representativeUserId: number,
) {
  await assertVendorAdmin(actor);
  if (representativeUserId !== actor.userId) {
    throw new ManagedSubcontractorError(
      "The verified representative must claim their own vendor organization",
      403,
      "managed_subcontractor.representative_mismatch",
    );
  }
  const [representative] = await db
    .select({ verifiedAt: usersTable.emailVerifiedAt })
    .from(usersTable)
    .where(eq(usersTable.id, representativeUserId))
    .limit(1);
  if (!representative?.verifiedAt) {
    throw new ManagedSubcontractorError(
      "A verified representative is required",
      403,
      "managed_subcontractor.representative_unverified",
    );
  }

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select()
      .from(managedSubcontractorOrganizationsTable)
      .where(eq(managedSubcontractorOrganizationsTable.id, managedOrganizationId))
      .limit(1);
    if (!organization) {
      throw new ManagedSubcontractorError(
        "Managed organization not found",
        404,
        "managed_subcontractor.not_found",
      );
    }
    if (organization.claimedVendorId !== null && organization.claimedVendorId !== actor.vendorId) {
      throw new ManagedSubcontractorError(
        "Managed organization has already been claimed",
        409,
        "managed_subcontractor.already_claimed",
      );
    }
    const workers = await tx
      .select({ workerUserId: managedSubcontractorWorkerSponsorshipsTable.workerUserId })
      .from(managedSubcontractorWorkerSponsorshipsTable)
      .where(
        eq(
          managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId,
          managedOrganizationId,
        ),
      );
    const [updated] = await tx
      .update(managedSubcontractorOrganizationsTable)
      .set({
        status: "claimed",
        claimedVendorId: actor.vendorId,
        claimedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(managedSubcontractorOrganizationsTable.id, managedOrganizationId))
      .returning();
    await tx
      .insert(managedSubcontractorClaimsTable)
      .values({
        managedOrganizationId,
        claimedVendorId: actor.vendorId,
        representativeUserId,
        claimedByUserId: actor.userId,
        workerIdentitySnapshot: [...new Set(workers.map((row) => row.workerUserId))],
      })
      .onConflictDoNothing({ target: managedSubcontractorClaimsTable.managedOrganizationId });
    if (!updated) throw new Error("Managed organization claim returned no row");
    return updated;
  });
}
