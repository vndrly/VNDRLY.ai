import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  accountInvitationsTable,
  db,
  managedSubcontractorSponsorsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
  workParticipationAuthorizationsTable,
} from "@workspace/db";
import type {
  ClaimAccountInvitationInput,
  IssueAccountInvitationInput,
} from "@workspace/api-zod";
import { getAppOrigin } from "../lib/appOrigin";
import { sendAccountInvitationEmail } from "../lib/sendgrid";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1_000;

export class AccountInvitationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface AccountInvitationActor {
  userId: number;
  vendorId: number;
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function tokenHash(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

async function assertVendorAdmin(actor: AccountInvitationActor): Promise<void> {
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
    throw new AccountInvitationError(
      "Vendor administrator access required",
      403,
      "account_invitation.vendor_admin_required",
    );
  }
}

async function assertManagedOrganizationSponsor(
  actor: AccountInvitationActor,
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
    throw new AccountInvitationError(
      "Managed organization not found",
      404,
      "account_invitation.managed_organization_not_found",
    );
  }
}

async function deliverInvitation(args: {
  invitationId: string;
  rawToken: string;
  email: string;
  username: string;
  sponsorName: string;
  expiresAt: Date;
}): Promise<void> {
  try {
    const { messageId } = await sendAccountInvitationEmail({
      to: args.email,
      username: args.username,
      sponsorName: args.sponsorName,
      expiresAt: args.expiresAt,
      activationUrl: `${getAppOrigin()}/activate-account?token=${encodeURIComponent(args.rawToken)}`,
    });
    await db
      .update(accountInvitationsTable)
      .set({
        state: "delivered",
        deliveredAt: new Date(),
        deliveryMessageId: messageId ?? null,
        deliveryError: null,
        updatedAt: new Date(),
      })
      .where(eq(accountInvitationsTable.id, args.invitationId));
  } catch (error) {
    await db
      .update(accountInvitationsTable)
      .set({
        state: "delivery_failed",
        deliveryError: error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed",
        updatedAt: new Date(),
      })
      .where(eq(accountInvitationsTable.id, args.invitationId));
  }
}

export async function issueAccountInvitation(
  actor: AccountInvitationActor,
  input: IssueAccountInvitationInput,
) {
  await assertManagedOrganizationSponsor(actor, input.managedOrganizationId);
  const rawToken = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const email = input.email.trim().toLocaleLowerCase("en-US");
  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  const issued = await db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, email))
      .limit(1);
    if (existingUser) {
      throw new AccountInvitationError(
        "An account already exists for this email",
        409,
        "account_invitation.account_exists",
      );
    }
    const [user] = await tx
      .insert(usersTable)
      .values({
        username: email,
        email,
        displayName: input.displayName,
        passwordHash: unusablePasswordHash,
        role: "field_employee",
        mustChangePassword: false,
      })
      .returning();
    if (!user) throw new Error("Invitation user insert returned no row");
    await tx.insert(managedSubcontractorWorkerSponsorshipsTable).values({
      workerUserId: user.id,
      sponsorVendorId: actor.vendorId,
      managedOrganizationId: input.managedOrganizationId,
      invitedByUserId: actor.userId,
    });
    const [invitation] = await tx
      .insert(accountInvitationsTable)
      .values({
        sponsorVendorId: actor.vendorId,
        managedOrganizationId: input.managedOrganizationId,
        userId: user.id,
        username: email,
        email,
        tokenHash: tokenHash(rawToken),
        authorizationVersion: input.authorizationVersion,
        expiresAt,
        issuedByUserId: actor.userId,
      })
      .returning();
    if (!invitation) throw new Error("Account invitation insert returned no row");
    const [vendor] = await tx
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, actor.vendorId))
      .limit(1);
    return { invitation, user, sponsorName: vendor?.name ?? "your sponsoring company" };
  });

  await deliverInvitation({
    invitationId: issued.invitation.id,
    rawToken,
    email,
    username: email,
    sponsorName: issued.sponsorName,
    expiresAt,
  });
  return { invitationId: issued.invitation.id, userId: issued.user.id, rawToken, expiresAt };
}

export async function resendAccountInvitation(
  actor: AccountInvitationActor,
  invitationId: string,
) {
  await assertVendorAdmin(actor);
  const [invitation] = await db
    .select()
    .from(accountInvitationsTable)
    .where(
      and(
        eq(accountInvitationsTable.id, invitationId),
        eq(accountInvitationsTable.sponsorVendorId, actor.vendorId),
        ne(accountInvitationsTable.state, "claimed"),
        ne(accountInvitationsTable.state, "revoked"),
      ),
    )
    .limit(1);
  if (!invitation) {
    throw new AccountInvitationError(
      "Invitation not found",
      404,
      "account_invitation.not_found",
    );
  }
  const rawToken = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await db
    .update(accountInvitationsTable)
    .set({
      tokenHash: tokenHash(rawToken),
      state: "pending",
      expiresAt,
      deliveredAt: null,
      deliveryMessageId: null,
      deliveryError: null,
      updatedAt: new Date(),
    })
    .where(eq(accountInvitationsTable.id, invitationId));
  const [vendor] = await db
    .select({ name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, actor.vendorId))
    .limit(1);
  await deliverInvitation({
    invitationId,
    rawToken,
    email: invitation.email,
    username: invitation.username,
    sponsorName: vendor?.name ?? "your sponsoring company",
    expiresAt,
  });
  return { invitationId, userId: invitation.userId, rawToken, expiresAt };
}

export async function revokeAccountInvitation(
  actor: AccountInvitationActor,
  invitationId: string,
): Promise<void> {
  await assertVendorAdmin(actor);
  const [revoked] = await db
    .update(accountInvitationsTable)
    .set({ state: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(accountInvitationsTable.id, invitationId),
        eq(accountInvitationsTable.sponsorVendorId, actor.vendorId),
        ne(accountInvitationsTable.state, "claimed"),
      ),
    )
    .returning({ id: accountInvitationsTable.id });
  if (!revoked) {
    throw new AccountInvitationError(
      "Invitation not found",
      404,
      "account_invitation.not_found",
    );
  }
}

export async function getInvitationStatus(rawToken: string): Promise<{
  state: "pending" | "claimed" | "expired" | "revoked" | "invalid";
  username?: string;
  sponsorName?: string;
  expiresAt?: string;
}> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) return { state: "invalid" };
  const [row] = await db
    .select({
      id: accountInvitationsTable.id,
      state: accountInvitationsTable.state,
      username: accountInvitationsTable.username,
      expiresAt: accountInvitationsTable.expiresAt,
      sponsorName: vendorsTable.name,
    })
    .from(accountInvitationsTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, accountInvitationsTable.sponsorVendorId))
    .where(eq(accountInvitationsTable.tokenHash, tokenHash(rawToken)))
    .limit(1);
  if (!row) return { state: "invalid" };
  if (row.state === "revoked") return { state: "revoked" };
  if (row.state === "claimed") return { state: "claimed" };
  if (row.state === "expired" || row.expiresAt.getTime() <= Date.now()) {
    if (row.state !== "expired") {
      await db
        .update(accountInvitationsTable)
        .set({ state: "expired", updatedAt: new Date() })
        .where(eq(accountInvitationsTable.id, row.id));
    }
    return { state: "expired" };
  }
  return {
    state: "pending",
    username: row.username,
    sponsorName: row.sponsorName,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function claimAccountInvitation(
  rawToken: string,
  input: ClaimAccountInvitationInput,
) {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    throw new AccountInvitationError("Invitation is invalid or unavailable", 410, "account_invitation.invalid");
  }
  const hash = tokenHash(rawToken);
  const passwordHash = await bcrypt.hash(input.password, 10);
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(accountInvitationsTable)
      .where(eq(accountInvitationsTable.tokenHash, hash))
      .limit(1);
    if (!invitation) {
      throw new AccountInvitationError("Invitation is invalid or unavailable", 410, "account_invitation.invalid");
    }
    if (invitation.state === "claimed" || invitation.state === "revoked") {
      throw new AccountInvitationError("Invitation is no longer available", 410, "account_invitation.unavailable");
    }
    if (invitation.expiresAt.getTime() <= Date.now() || invitation.state === "expired") {
      await tx
        .update(accountInvitationsTable)
        .set({ state: "expired", updatedAt: new Date() })
        .where(eq(accountInvitationsTable.id, invitation.id));
      throw new AccountInvitationError("Invitation has expired", 410, "account_invitation.expired");
    }
    if (input.authorizationVersion !== invitation.authorizationVersion) {
      throw new AccountInvitationError(
        "Work participation authorization has changed",
        409,
        "account_invitation.authorization_version_changed",
      );
    }
    const now = new Date();
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        emailVerifiedAt: now,
        mustChangePassword: false,
        sessionVersion: sql`${usersTable.sessionVersion} + 1`,
      })
      .where(eq(usersTable.id, invitation.userId));
    await tx
      .insert(workParticipationAuthorizationsTable)
      .values({
        userId: invitation.userId,
        sponsorVendorId: invitation.sponsorVendorId,
        managedOrganizationId: invitation.managedOrganizationId,
        authorizationVersion: invitation.authorizationVersion,
        evidence: { invitationId: invitation.id },
      })
      .onConflictDoNothing();
    await tx
      .update(accountInvitationsTable)
      .set({ state: "claimed", claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(accountInvitationsTable.id, invitation.id),
          ne(accountInvitationsTable.state, "claimed"),
        ),
      );
    return { state: "claimed" as const, userId: invitation.userId };
  });
}
