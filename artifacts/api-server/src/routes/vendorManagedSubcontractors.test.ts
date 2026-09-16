import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import router from "./implementationASponsorships";
import authRouter from "./auth";
import operationsRouter from "./workHubOperations";
import { buildTestCookie } from "../test-utils/session";
const app = express()
  .use(express.json())
  .use(cookieParser())
  .use(router)
  .use(authRouter)
  .use(operationsRouter);
describe("vendor managed subcontractor boundary", () => {
  it("rejects cross-vendor administration before reading or changing records", async () => {
    const cookie = buildTestCookie({
      userId: 1,
      role: "vendor",
      vendorId: 10,
      membershipRole: "admin",
    });
    const response = await request(app)
      .get("/vendors/20/managed-subcontractors")
      .set("Cookie", cookie);
    expect(response.status).toBe(403);
  });
  it("rejects non-admin worker creation", async () => {
    const cookie = buildTestCookie({
      userId: 1,
      role: "vendor",
      vendorId: 10,
      membershipRole: "member",
    });
    const response = await request(app)
      .post(
        "/vendors/10/managed-subcontractors/11111111-1111-4111-8111-111111111111/workers",
      )
      .set("Cookie", cookie)
      .send({});
    expect(response.status).toBe(403);
  });
  it("rejects unscoped roles and administrator-supplied passwords", async () => {
    const cookie = buildTestCookie({
      userId: 1,
      role: "vendor",
      vendorId: 10,
      membershipRole: "admin",
    });
    for (const body of [
      {
        name: "Worker",
        email: "worker@example.com",
        role: "admin",
        siteIds: [1],
      },
      {
        name: "Worker",
        email: "worker@example.com",
        role: "gatekeeper",
        siteIds: [],
      },
      {
        name: "Worker",
        email: "worker@example.com",
        role: "gatekeeper",
        siteIds: [1],
        password: "unauthorized-password",
      },
    ]) {
      const response = await request(app)
        .post(
          "/vendors/10/managed-subcontractors/11111111-1111-4111-8111-111111111111/workers",
        )
        .set("Cookie", cookie)
        .send(body);
      expect(response.status).toBe(400);
    }
  });
});

import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  vendorsTable,
  partnersTable,
  usersTable,
  userOrgMembershipsTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  workTypesTable,
  vendorPeopleTable,
  workHubTasksTable,
  workHubShiftsTable,
  workHubMeetingsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
  managedSubcontractorRoleGrantsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  accountInvitationsTable,
} from "@workspace/db";
import { claimAccountInvitation } from "../services/account-invitations";
vi.mock("../lib/sendgrid", () => ({
  sendAccountInvitationEmail: vi
    .fn()
    .mockRejectedValue(new Error("Email unavailable")),
}));
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" ||
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
describe.skipIf(!isolated)("managed worker onboarding and revocation", () => {
  let adminUserId: number,
    vendorId: number,
    siteId: number,
    otherSiteId: number,
    cookie: string;
  const previousWorkHubEnabled = process.env.WORK_HUB_ENABLED;
  afterAll(() => {
    if (previousWorkHubEnabled === undefined)
      delete process.env.WORK_HUB_ENABLED;
    else process.env.WORK_HUB_ENABLED = previousWorkHubEnabled;
  });
  beforeAll(async () => {
    process.env.WORK_HUB_ENABLED = "1";
    const suffix = randomUUID();
    const [vendor] = await db
      .insert(vendorsTable)
      .values({
        name: `Midcon ${suffix}`,
        contactName: "Admin",
        contactEmail: `${suffix}@example.invalid`,
      })
      .returning();
    vendorId = vendor.id;
    const [admin] = await db
      .insert(usersTable)
      .values({
        username: `admin-${suffix}`,
        displayName: "Admin",
        passwordHash: "unused",
        role: "vendor",
      })
      .returning();
    await db
      .insert(userOrgMembershipsTable)
      .values({ userId: admin.id, orgType: "vendor", vendorId, role: "admin" });
    adminUserId = admin.id;
    cookie = buildTestCookie({
      userId: admin.id,
      role: "vendor",
      vendorId,
      membershipRole: "admin",
    });
    const [partner] = await db
      .insert(partnersTable)
      .values({
        name: `Partner ${suffix}`,
        contactName: "Contact",
        contactEmail: `${suffix}@example.invalid`,
      })
      .returning();
    const sites = await db
      .insert(siteLocationsTable)
      .values(
        ["Assigned", "Unassigned"].map((name) => ({
          partnerId: partner.id,
          name,
          address: "Site",
          latitude: 1,
          longitude: 1,
          siteCode: `${name}-${suffix}`,
        })),
      )
      .returning();
    [siteId, otherSiteId] = sites.map((site) => site.id);
    const [work] = await db
      .insert(workTypesTable)
      .values({ name: `Gate ${suffix}`, category: "Gate" })
      .returning();
    await db
      .insert(siteWorkAssignmentsTable)
      .values({ vendorId, siteLocationId: siteId, workTypeId: work.id });
  });
  it("creates an independently activated worker, excludes payroll, scopes sites and preserves history on revoke", async () => {
    const base = `/vendors/${vendorId}/managed-subcontractors`;
    const org = await request(app)
      .post(base)
      .set("Cookie", cookie)
      .send({ name: "NewTech" });
    expect(org.status).toBe(201);
    const email = `${randomUUID()}@example.invalid`;
    const badScope = await request(app)
      .post(`${base}/${org.body.id}/workers`)
      .set("Cookie", cookie)
      .send({
        name: "Gate Worker",
        email,
        role: "gatekeeper",
        siteIds: [otherSiteId],
      });
    expect(badScope.status).toBe(403);
    const created = await request(app)
      .post(`${base}/${org.body.id}/workers`)
      .set("Cookie", cookie)
      .send({
        name: "Gate Worker",
        email,
        role: "gatekeeper",
        siteIds: [siteId],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email,
      role: "gatekeeper",
      siteIds: [siteId],
      invitationState: "delivery_failed",
    });
    expect(created.headers["cache-control"]).toBe("no-store");
    const legacyGrant = await request(app)
      .post("/implementation-a/sponsorships/" + created.body.id + "/roles")
      .set("Cookie", cookie)
      .send({ role: "gatekeeper", siteId: otherSiteId });
    expect(legacyGrant.status).toBe(403);
    const userId = created.body.userId as number;
    // Model a successful generic password reset before work participation consent.
    await db
      .update(usersTable)
      .set({
        passwordHash: await bcrypt.hash("reset-before-consent-password", 10),
      })
      .where(eq(usersTable.id, userId));
    const unclaimedLogin = await request(app)
      .post("/auth/login")
      .send({ username: email, password: "reset-before-consent-password" });
    expect(unclaimedLogin.status).toBe(200);
    expect(unclaimedLogin.body).toMatchObject({
      vendorId: null,
      vendorRole: null,
      activeMembershipId: null,
      availableMemberships: [],
      managedSubcontractor: { siteGrants: [] },
    });
    const unclaimedTasks = await request(app)
      .get("/work-hub/tasks")
      .set("Cookie", "vndrly_session=" + unclaimedLogin.body.token);
    expect(unclaimedTasks.status).toBe(401);
    expect(unclaimedTasks.body.code).toBe("auth.unauthenticated");
    const [membership] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, userId),
          eq(userOrgMembershipsTable.vendorId, vendorId),
        ),
      );
    expect(membership).toMatchObject({
      role: "field_employee",
      vendorPeopleId: null,
    });
    expect(
      await db
        .select()
        .from(vendorPeopleTable)
        .where(eq(vendorPeopleTable.userId, userId)),
    ).toHaveLength(0);
    const repeated = await request(app)
      .post(`${base}/${org.body.id}/workers`)
      .set("Cookie", cookie)
      .send({
        name: "Gate Worker",
        email: email.toUpperCase(),
        role: "gatekeeper",
        siteIds: [siteId],
      });
    expect(repeated.status).toBe(409);
    const oldToken = new URL(created.body.activationUrl).searchParams.get(
      "token",
    )!;
    const resent = await request(app)
      .post(
        `${base}/${org.body.id}/workers/${created.body.id}/resend-invitation`,
      )
      .set("Cookie", cookie)
      .send({});
    expect(resent.status).toBe(200);
    await expect(
      claimAccountInvitation(oldToken, {
        password: "a-secure-worker-password",
        authorizationVersion: "work-participation-2026-09",
      }),
    ).rejects.toMatchObject({ status: 410 });
    const token = new URL(resent.body.activationUrl).searchParams.get("token")!;
    await expect(
      claimAccountInvitation(token, {
        password: "a-secure-worker-password",
        authorizationVersion: "work-participation-2026-09",
      }),
    ).resolves.toMatchObject({ state: "claimed", userId });
    const login = await request(app)
      .post("/auth/login")
      .send({ username: email, password: "a-secure-worker-password" });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({
      role: "field_employee",
      vendorId,
      vendorPeopleId: null,
      managedSubcontractor: { siteGrants: [{ siteId, role: "gatekeeper" }] },
    });
    await db.insert(workHubTasksTable).values({
      ownerOrgType: "vendor",
      ownerOrgId: vendorId,
      title: "Assigned gate task",
      assigneeUserId: userId,
      createdById: userId,
    });
    await db.insert(workHubShiftsTable).values({
      ownerOrgType: "vendor",
      ownerOrgId: vendorId,
      title: "Shared gate shift",
      startsAt: new Date("2026-09-16T12:00:00Z"),
      endsAt: new Date("2026-09-16T20:00:00Z"),
      timezone: "UTC",
      createdById: adminUserId,
      sharedWithUserIds: [userId],
    });
    const [meeting] = await db
      .insert(workHubMeetingsTable)
      .values({
        ownerOrgType: "vendor",
        ownerOrgId: vendorId,
        title: "Gate briefing",
        timezone: "UTC",
        createdById: adminUserId,
      })
      .returning();
    const [occurrence] = await db
      .insert(workHubMeetingOccurrencesTable)
      .values({
        meetingId: meeting.id,
        startsAt: new Date("2026-09-16T12:00:00Z"),
      })
      .returning();
    await db
      .insert(workHubMeetingParticipantsTable)
      .values({ occurrenceId: occurrence.id, userId });
    const activeCalendar = await request(app)
      .get("/work-hub/calendar?start=2026-01-01&end=2027-01-01")
      .set("Cookie", "vndrly_session=" + login.body.token);
    expect(activeCalendar.status).toBe(200);
    expect(activeCalendar.body.shifts).toHaveLength(1);
    expect(activeCalendar.body.meetings).toHaveLength(1);
    const activeTasks = await request(app)
      .get("/work-hub/tasks")
      .set("Cookie", "vndrly_session=" + login.body.token);
    expect(activeTasks.status).toBe(200);
    expect(
      activeTasks.body.map((task: { title: string }) => task.title),
    ).toContain("Assigned gate task");
    const edited = await request(app)
      .patch(`${base}/${org.body.id}/workers/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ role: "gate_supervisor", siteIds: [siteId] });
    expect(edited.status).toBe(200);
    expect(edited.body.role).toBe("gate_supervisor");
    const [before] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const revoked = await request(app)
      .patch(`${base}/${org.body.id}/workers/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ status: "terminated" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("terminated");
    const [after] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(after.activeMembershipId).toBeNull();
    const revokedLogin = await request(app)
      .post("/auth/login")
      .send({ username: email, password: "a-secure-worker-password" });
    expect(revokedLogin.status).toBe(200);
    expect(revokedLogin.body.vendorId).toBeNull();
    expect(revokedLogin.body.availableMemberships).toEqual([]);
    expect(revokedLogin.body.managedSubcontractor).toEqual({ siteGrants: [] });
    const revokedTasks = await request(app)
      .get("/work-hub/tasks")
      .set("Cookie", "vndrly_session=" + revokedLogin.body.token);
    expect(revokedTasks.status).toBe(401);
    expect(revokedTasks.body.code).toBe("auth.unauthenticated");
    const revokedCalendar = await request(app)
      .get("/work-hub/calendar?start=2026-01-01&end=2027-01-01")
      .set("Cookie", "vndrly_session=" + revokedLogin.body.token);
    expect(revokedCalendar.status).toBe(401);
    expect(revokedCalendar.body.code).toBe("auth.unauthenticated");
    expect(
      await db
        .select()
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, userId),
            eq(userOrgMembershipsTable.vendorId, vendorId),
          ),
        ),
    ).toHaveLength(0);
    const grants = await db
      .select()
      .from(managedSubcontractorRoleGrantsTable)
      .where(
        eq(managedSubcontractorRoleGrantsTable.sponsorshipId, created.body.id),
      );
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => grant.status === "inactive")).toBe(true);
    expect(
      await db
        .select()
        .from(managedSubcontractorWorkerSponsorshipsTable)
        .where(
          eq(managedSubcontractorWorkerSponsorshipsTable.id, created.body.id),
        ),
    ).toHaveLength(1);
  });
});
