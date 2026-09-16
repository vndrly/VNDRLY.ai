import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  managedSubcontractorClaimsTable,
  managedSubcontractorOrganizationsTable,
  managedSubcontractorRoleGrantsTable,
  managedSubcontractorSponsorsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  userOrgMembershipsTable,
  usersTable,
  accountInvitationsTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  workHubCrewsTable,
} from "@workspace/db";
import type {
  GrantSponsoredRoleInput,
  ManagedSubcontractorRole,
} from "@workspace/api-zod";
import {
  issueAccountInvitation,
  resendAccountInvitation,
} from "./account-invitations";
import { getAppOrigin } from "../lib/appOrigin";

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

async function assertVendorAdmin(
  actor: ManagedSubcontractorActor,
): Promise<void> {
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
        eq(
          managedSubcontractorSponsorsTable.managedOrganizationId,
          managedOrganizationId,
        ),
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
    if (!organization)
      throw new Error("Managed organization insert returned no row");
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
        eq(
          managedSubcontractorWorkerSponsorshipsTable.workerUserId,
          workerUserId,
        ),
        eq(
          managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
          actor.vendorId,
        ),
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
        eq(
          managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
          actor.vendorId,
        ),
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
  await assertActiveSponsor(actor, sponsorship.managedOrganizationId);
  if (input.siteId != null)
    await assertManagedWorkerSites(actor.vendorId, [input.siteId]);
  if (input.crewId != null) {
    const [crew] = await db
      .select({ id: workHubCrewsTable.id })
      .from(workHubCrewsTable)
      .where(
        and(
          eq(workHubCrewsTable.id, input.crewId),
          eq(workHubCrewsTable.ownerOrgType, "vendor"),
          eq(workHubCrewsTable.ownerOrgId, actor.vendorId),
        ),
      )
      .limit(1);
    if (!crew)
      throw new ManagedSubcontractorError(
        "Crew not found",
        404,
        "managed_subcontractor.crew_not_found",
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
    eq(
      managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
      actor.vendorId,
    ),
  ];
  if (workerUserId !== undefined) {
    conditions.push(
      eq(
        managedSubcontractorWorkerSponsorshipsTable.workerUserId,
        workerUserId,
      ),
    );
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
      .where(
        eq(managedSubcontractorOrganizationsTable.id, managedOrganizationId),
      )
      .limit(1);
    if (!organization) {
      throw new ManagedSubcontractorError(
        "Managed organization not found",
        404,
        "managed_subcontractor.not_found",
      );
    }
    if (
      organization.claimedVendorId !== null &&
      organization.claimedVendorId !== actor.vendorId
    ) {
      throw new ManagedSubcontractorError(
        "Managed organization has already been claimed",
        409,
        "managed_subcontractor.already_claimed",
      );
    }
    const workers = await tx
      .select({
        workerUserId: managedSubcontractorWorkerSponsorshipsTable.workerUserId,
      })
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
      .where(
        eq(managedSubcontractorOrganizationsTable.id, managedOrganizationId),
      )
      .returning();
    await tx
      .insert(managedSubcontractorClaimsTable)
      .values({
        managedOrganizationId,
        claimedVendorId: actor.vendorId,
        representativeUserId,
        claimedByUserId: actor.userId,
        workerIdentitySnapshot: [
          ...new Set(workers.map((row) => row.workerUserId)),
        ],
      })
      .onConflictDoNothing({
        target: managedSubcontractorClaimsTable.managedOrganizationId,
      });
    if (!updated) throw new Error("Managed organization claim returned no row");
    return updated;
  });
}

/** Eligible sites come from the sponsor's own active site assignments. */
export async function listManagedWorkerSites(vendorId: number) {
  return db
    .selectDistinct({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
    })
    .from(siteLocationsTable)
    .innerJoin(
      siteWorkAssignmentsTable,
      eq(siteWorkAssignmentsTable.siteLocationId, siteLocationsTable.id),
    )
    .where(
      and(
        eq(siteWorkAssignmentsTable.vendorId, vendorId),
        eq(siteLocationsTable.isActive, true),
        eq(siteLocationsTable.hidden, false),
      ),
    )
    .orderBy(siteLocationsTable.name);
}

async function assertManagedWorkerSites(vendorId: number, siteIds: number[]) {
  const allowed = new Set(
    (await listManagedWorkerSites(vendorId)).map((site) => site.id),
  );
  if (!siteIds.length || siteIds.some((id) => !allowed.has(id))) {
    throw new ManagedSubcontractorError(
      "Select sites assigned to your company",
      403,
      "managed_subcontractor.site_not_permitted",
    );
  }
}

export async function listManagedOrganizations(
  actor: ManagedSubcontractorActor,
) {
  await assertVendorAdmin(actor);
  const organizations = await db
    .select({
      id: managedSubcontractorOrganizationsTable.id,
      name: managedSubcontractorOrganizationsTable.name,
      status: managedSubcontractorOrganizationsTable.status,
    })
    .from(managedSubcontractorOrganizationsTable)
    .innerJoin(
      managedSubcontractorSponsorsTable,
      eq(
        managedSubcontractorSponsorsTable.managedOrganizationId,
        managedSubcontractorOrganizationsTable.id,
      ),
    )
    .where(
      and(
        eq(managedSubcontractorSponsorsTable.sponsorVendorId, actor.vendorId),
        eq(managedSubcontractorSponsorsTable.status, "active"),
      ),
    );
  const workers = await db
    .select({
      id: managedSubcontractorWorkerSponsorshipsTable.id,
      organizationId:
        managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId,
      userId: usersTable.id,
      name: usersTable.displayName,
      email: usersTable.email,
      status: managedSubcontractorWorkerSponsorshipsTable.status,
    })
    .from(managedSubcontractorWorkerSponsorshipsTable)
    .innerJoin(
      usersTable,
      eq(
        usersTable.id,
        managedSubcontractorWorkerSponsorshipsTable.workerUserId,
      ),
    )
    .where(
      eq(
        managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
        actor.vendorId,
      ),
    );
  const grants = workers.length
    ? await db
        .select()
        .from(managedSubcontractorRoleGrantsTable)
        .where(
          and(
            inArray(
              managedSubcontractorRoleGrantsTable.sponsorshipId,
              workers.map((w) => w.id),
            ),
            eq(managedSubcontractorRoleGrantsTable.status, "active"),
          ),
        )
    : [];
  const invitations = await db
    .select({
      id: accountInvitationsTable.id,
      userId: accountInvitationsTable.userId,
      state: accountInvitationsTable.state,
      expiresAt: accountInvitationsTable.expiresAt,
    })
    .from(accountInvitationsTable)
    .where(eq(accountInvitationsTable.sponsorVendorId, actor.vendorId));
  return {
    items: organizations.map((org) => ({
      ...org,
      workers: workers
        .filter((worker) => worker.organizationId === org.id)
        .map((worker) => {
          const roles = grants.filter(
            (grant) => grant.sponsorshipId === worker.id,
          );
          const invitation = invitations.find(
            (row) => row.userId === worker.userId,
          );
          return {
            ...worker,
            role:
              roles.find((grant) => grant.role === "gate_supervisor")?.role ??
              roles[0]?.role ??
              null,
            siteIds: [
              ...new Set(
                roles.flatMap((grant) =>
                  grant.siteId === null ? [] : [grant.siteId],
                ),
              ),
            ],
            invitationId: invitation?.id ?? null,
            invitationState:
              invitation &&
              !["claimed", "revoked"].includes(invitation.state) &&
              invitation.expiresAt < new Date()
                ? "expired"
                : (invitation?.state ?? null),
          };
        }),
    })),
    sites: await listManagedWorkerSites(actor.vendorId),
  };
}

export async function createManagedWorker(
  actor: ManagedSubcontractorActor,
  organizationId: string,
  input: {
    name: string;
    email: string;
    role: "gatekeeper" | "gate_supervisor";
    siteIds: number[];
  },
) {
  await assertActiveSponsor(actor, organizationId);
  await assertManagedWorkerSites(actor.vendorId, input.siteIds);
  const issued = await issueAccountInvitation(
    actor,
    {
      email: input.email,
      displayName: input.name,
      managedOrganizationId: organizationId,
      authorizationVersion: "work-participation-2026-09",
    },
    { role: input.role, siteIds: [...new Set(input.siteIds)] },
  );
  const result = await listManagedOrganizations(actor);
  const worker = result.items
    .find((org) => org.id === organizationId)
    ?.workers.find((row) => row.userId === issued.userId);
  return {
    ...worker,
    invitation: { id: issued.invitationId, state: worker?.invitationState },
    activationUrl: `${getAppOrigin()}/activate-account?token=${encodeURIComponent(issued.rawToken)}`,
  };
}

export async function updateManagedWorker(
  actor: ManagedSubcontractorActor,
  organizationId: string,
  sponsorshipId: string,
  input:
    | { status: "terminated" }
    | { role: "gatekeeper" | "gate_supervisor"; siteIds: number[] },
) {
  await assertActiveSponsor(actor, organizationId);
  if ("siteIds" in input)
    await assertManagedWorkerSites(actor.vendorId, input.siteIds);
  await db.transaction(async (tx) => {
    const [sponsorship] = await tx
      .select()
      .from(managedSubcontractorWorkerSponsorshipsTable)
      .where(
        and(
          eq(managedSubcontractorWorkerSponsorshipsTable.id, sponsorshipId),
          eq(
            managedSubcontractorWorkerSponsorshipsTable.managedOrganizationId,
            organizationId,
          ),
          eq(
            managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
            actor.vendorId,
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (!sponsorship || sponsorship.status !== "active")
      throw new ManagedSubcontractorError(
        "Active sponsorship not found",
        404,
        "managed_subcontractor.sponsorship_not_found",
      );
    const now = new Date();
    await tx
      .update(managedSubcontractorRoleGrantsTable)
      .set({ status: "inactive", endedAt: now })
      .where(
        and(
          eq(managedSubcontractorRoleGrantsTable.sponsorshipId, sponsorshipId),
          eq(managedSubcontractorRoleGrantsTable.status, "active"),
        ),
      );
    if ("role" in input) {
      await tx.insert(managedSubcontractorRoleGrantsTable).values(
        [...new Set(input.siteIds)].map((siteId) => ({
          sponsorshipId,
          role: input.role,
          siteId,
          grantedByUserId: actor.userId,
        })),
      );
    } else {
      await tx
        .update(managedSubcontractorWorkerSponsorshipsTable)
        .set({ status: "terminated", endedAt: now, updatedAt: now })
        .where(
          eq(managedSubcontractorWorkerSponsorshipsTable.id, sponsorshipId),
        );
      await tx
        .update(accountInvitationsTable)
        .set({ state: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(accountInvitationsTable.userId, sponsorship.workerUserId),
            eq(accountInvitationsTable.sponsorVendorId, actor.vendorId),
            eq(accountInvitationsTable.managedOrganizationId, organizationId),
            ne(accountInvitationsTable.state, "claimed"),
          ),
        );
      const remaining = await tx
        .select({ id: managedSubcontractorWorkerSponsorshipsTable.id })
        .from(managedSubcontractorWorkerSponsorshipsTable)
        .where(
          and(
            eq(
              managedSubcontractorWorkerSponsorshipsTable.workerUserId,
              sponsorship.workerUserId,
            ),
            eq(
              managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
              actor.vendorId,
            ),
            eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
          ),
        )
        .limit(1);
      if (!remaining.length) {
        await tx
          .delete(userOrgMembershipsTable)
          .where(
            and(
              eq(userOrgMembershipsTable.userId, sponsorship.workerUserId),
              eq(userOrgMembershipsTable.vendorId, actor.vendorId),
              eq(userOrgMembershipsTable.role, "field_employee"),
              isNull(userOrgMembershipsTable.vendorPeopleId),
            ),
          );
      }
    }
    await tx
      .update(usersTable)
      .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
      .where(eq(usersTable.id, sponsorship.workerUserId));
  });
  const list = await listManagedOrganizations(actor);
  return list.items
    .find((org) => org.id === organizationId)
    ?.workers.find((worker) => worker.id === sponsorshipId);
}

export async function resendManagedWorkerInvitation(
  actor: ManagedSubcontractorActor,
  organizationId: string,
  sponsorshipId: string,
) {
  await assertActiveSponsor(actor, organizationId);
  const list = await listManagedOrganizations(actor);
  const worker = list.items
    .find((org) => org.id === organizationId)
    ?.workers.find(
      (row) => row.id === sponsorshipId && row.status === "active",
    );
  if (!worker?.invitationId)
    throw new ManagedSubcontractorError(
      "Invitation not found",
      404,
      "managed_subcontractor.invitation_not_found",
    );
  const issued = await resendAccountInvitation(actor, worker.invitationId);
  const [invitation] = await db
    .select({ state: accountInvitationsTable.state })
    .from(accountInvitationsTable)
    .where(eq(accountInvitationsTable.id, issued.invitationId));
  return {
    invitation: { id: issued.invitationId, state: invitation!.state },
    activationUrl: `${getAppOrigin()}/activate-account?token=${encodeURIComponent(issued.rawToken)}`,
  };
}
