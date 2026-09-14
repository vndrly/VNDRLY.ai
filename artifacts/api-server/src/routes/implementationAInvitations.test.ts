import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  accountInvitationsTable,
  db,
  managedSubcontractorOrganizationsTable,
  managedSubcontractorSponsorsTable,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
  workParticipationAuthorizationsTable,
} from "@workspace/db";
import {
  claimAccountInvitation,
  getInvitationStatus,
  issueAccountInvitation,
  resendAccountInvitation,
  revokeAccountInvitation,
} from "../services/account-invitations";
import invitationsRouter from "./implementationAInvitations";
import { buildTestCookie } from "../test-utils/session";

const sendAccountInvitationEmailMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/sendgrid", () => ({
  sendAccountInvitationEmail: sendAccountInvitationEmailMock,
}));

const app = express().use(express.json()).use(cookieParser()).use(invitationsRouter);

const usesIsolatedDatabase =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" ||
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";

describe.skipIf(!usesIsolatedDatabase)("secure account invitations", () => {
  let vendorId: number;
  let adminId: number;
  let managedOrganizationId: string;
  let adminCookie: string;
  const actor = () => ({ userId: adminId, vendorId });

  beforeAll(async () => {
    sendAccountInvitationEmailMock.mockResolvedValue({ messageId: "test-message" });
    const suffix = randomUUID();
    const [vendor] = await db
      .insert(vendorsTable)
      .values({
        name: `Invitation Sponsor ${suffix}`,
        contactName: "Invitation Admin",
        contactEmail: `admin.${suffix}@example.invalid`,
      })
      .returning();
    vendorId = vendor!.id;
    const [admin] = await db
      .insert(usersTable)
      .values({
        username: `admin.${suffix}@example.invalid`,
        email: `admin.${suffix}@example.invalid`,
        emailVerifiedAt: new Date(),
        displayName: "Invitation Admin",
        passwordHash: "unused-fixture",
        role: "vendor",
      })
      .returning();
    adminId = admin!.id;
    adminCookie = buildTestCookie({ userId: adminId, role: "vendor", vendorId, membershipRole: "admin" });
    await db.insert(userOrgMembershipsTable).values({
      userId: adminId,
      orgType: "vendor",
      vendorId,
      role: "admin",
    });
    const [organization] = await db
      .insert(managedSubcontractorOrganizationsTable)
      .values({
        name: `Invitation Managed Company ${suffix}`,
        canonicalName: `invitation managed company ${suffix}`,
        createdByVendorId: vendorId,
        createdByUserId: adminId,
      })
      .returning();
    managedOrganizationId = organization!.id;
    await db.insert(managedSubcontractorSponsorsTable).values({
      managedOrganizationId,
      sponsorVendorId: vendorId,
      createdByUserId: adminId,
    });
  });

  function invitationInput() {
    const suffix = randomUUID();
    return {
      email: `worker.${suffix}@example.invalid`,
      displayName: "Invited Worker",
      managedOrganizationId,
      authorizationVersion: "work-participation-2026-09",
    };
  }

  it("stores only the activation token hash and never creates a temporary password", async () => {
    const issued = await issueAccountInvitation(actor(), invitationInput());
    const [row] = await db
      .select()
      .from(accountInvitationsTable)
      .where(eq(accountInvitationsTable.id, issued.invitationId));
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, issued.userId));

    expect(row!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(issued.rawToken);
    expect(user!.mustChangePassword).toBe(false);
    expect(await bcrypt.compare("shared temporary password", user!.passwordHash)).toBe(false);
    expect(sendAccountInvitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user!.email,
        username: user!.username,
        activationUrl: expect.stringContaining(issued.rawToken),
      }),
    );
  });

  it("invalidates the old link when resent and permits only one successful claim", async () => {
    const issued = await issueAccountInvitation(actor(), invitationInput());
    const resent = await resendAccountInvitation(actor(), issued.invitationId);
    expect((await getInvitationStatus(issued.rawToken)).state).toBe("invalid");
    expect((await getInvitationStatus(resent.rawToken)).state).toBe("pending");

    const claimed = await claimAccountInvitation(resent.rawToken, {
      password: "Unique first password 42!",
      authorizationVersion: "work-participation-2026-09",
    });
    expect(claimed.state).toBe("claimed");
    expect((await getInvitationStatus(resent.rawToken)).state).toBe("claimed");
    await expect(
      claimAccountInvitation(resent.rawToken, {
        password: "Different password 42!",
        authorizationVersion: "work-participation-2026-09",
      }),
    ).rejects.toMatchObject({ status: 410 });

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, issued.userId));
    expect(await bcrypt.compare("Unique first password 42!", user!.passwordHash)).toBe(true);
    expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
    const authorization = await db
      .select()
      .from(workParticipationAuthorizationsTable)
      .where(
        and(
          eq(workParticipationAuthorizationsTable.userId, issued.userId),
          eq(
            workParticipationAuthorizationsTable.authorizationVersion,
            "work-participation-2026-09",
          ),
        ),
      );
    expect(authorization).toHaveLength(1);
  });

  it("supports revoked, expired, and delivery-failed states without exposing usernames", async () => {
    const revoked = await issueAccountInvitation(actor(), invitationInput());
    await revokeAccountInvitation(actor(), revoked.invitationId);
    expect(await getInvitationStatus(revoked.rawToken)).toEqual({ state: "revoked" });

    const expired = await issueAccountInvitation(actor(), invitationInput());
    await db
      .update(accountInvitationsTable)
      .set({ expiresAt: new Date(Date.now() - 1_000), state: "expired" })
      .where(eq(accountInvitationsTable.id, expired.invitationId));
    expect(await getInvitationStatus(expired.rawToken)).toEqual({ state: "expired" });

    sendAccountInvitationEmailMock.mockRejectedValueOnce(new Error("synthetic delivery failure"));
    const failed = await issueAccountInvitation(actor(), invitationInput());
    const [failedRow] = await db
      .select()
      .from(accountInvitationsTable)
      .where(eq(accountInvitationsTable.id, failed.invitationId));
    expect(failedRow!.state).toBe("delivery_failed");
    expect(JSON.stringify(await getInvitationStatus("f".repeat(64)))).not.toContain("worker");
    expect(JSON.stringify(failedRow)).not.toContain(failed.rawToken);
  });
  it("never exposes the raw token or a password through the HTTP API", async () => {
    const response = await request(app)
      .post("/implementation-a/account-invitations")
      .set("Cookie", adminCookie)
      .send(invitationInput());
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      invitationId: expect.any(String),
      userId: expect.any(Number),
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(/token|password/i);

    const invalid = await request(app).get(
      `/implementation-a/account-invitations/activate/${"f".repeat(64)}`,
    );
    expect(invalid.body).toEqual({ state: "invalid" });
  });
});
