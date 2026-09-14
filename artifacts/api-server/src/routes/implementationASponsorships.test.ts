import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import {
  db,
  managedSubcontractorClaimsTable,
  managedSubcontractorOrganizationsTable,
  managedSubcontractorWorkerSponsorshipsTable,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import sponsorshipsRouter from "./implementationASponsorships";
import { buildTestCookie } from "../test-utils/session";

const app = express()
  .use(express.json())
  .use(cookieParser())
  .use(sponsorshipsRouter);

const usesIsolatedDatabase =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" ||
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";

describe.skipIf(!usesIsolatedDatabase)("managed subcontractor sponsorships", () => {
  let firstVendorId: number;
  let secondVendorId: number;
  let claimedVendorId: number;
  let firstAdminId: number;
  let secondAdminId: number;
  let representativeId: number;
  let workerId: number;
  let firstAdminCookie: string;
  let secondAdminCookie: string;
  let representativeCookie: string;

  beforeAll(async () => {
    const suffix = randomUUID();
    const vendors = await db
      .insert(vendorsTable)
      .values(["First", "Second", "Claimed"].map((name) => ({
        name: `${name} Sponsor ${suffix}`,
        contactName: `${name} Admin`,
        contactEmail: `${name.toLowerCase()}.${suffix}@example.invalid`,
      })))
      .returning();
    [firstVendorId, secondVendorId, claimedVendorId] = vendors.map((row) => row.id);

    const users = await db
      .insert(usersTable)
      .values(["First Admin", "Second Admin", "Representative", "Portable Worker"].map((name) => ({
        username: `${name.toLowerCase().replaceAll(" ", ".")}.${suffix}@example.invalid`,
        email: `${name.toLowerCase().replaceAll(" ", ".")}.${suffix}@example.invalid`,
        emailVerifiedAt: new Date(),
        displayName: name,
        passwordHash: "unused-fixture",
        role: "vendor",
      })))
      .returning();
    [firstAdminId, secondAdminId, representativeId, workerId] = users.map((row) => row.id);

    await db.insert(userOrgMembershipsTable).values([
      { userId: firstAdminId, orgType: "vendor", vendorId: firstVendorId, role: "admin" },
      { userId: secondAdminId, orgType: "vendor", vendorId: secondVendorId, role: "admin" },
      { userId: representativeId, orgType: "vendor", vendorId: claimedVendorId, role: "admin" },
    ]);
    firstAdminCookie = buildTestCookie({
      userId: firstAdminId,
      role: "vendor",
      vendorId: firstVendorId,
      membershipRole: "admin",
    });
    secondAdminCookie = buildTestCookie({
      userId: secondAdminId,
      role: "vendor",
      vendorId: secondVendorId,
      membershipRole: "admin",
    });
    representativeCookie = buildTestCookie({
      userId: representativeId,
      role: "vendor",
      vendorId: claimedVendorId,
      membershipRole: "admin",
    });
  });

  async function createAndSponsor(cookie: string, name: string) {
    const created = await request(app)
      .post("/implementation-a/managed-organizations")
      .set("Cookie", cookie)
      .send({ name });
    expect(created.status).toBe(201);

    const invited = await request(app)
      .post(`/implementation-a/managed-organizations/${created.body.id}/workers`)
      .set("Cookie", cookie)
      .send({ workerUserId: workerId });
    expect(invited.status).toBe(201);
    return created.body.id as string;
  }

  it("keeps a portable worker's concurrent sponsorships private to each sponsor", async () => {
    const firstOrganizationId = await createAndSponsor(
      firstAdminCookie,
      "NewTek managed by first vendor",
    );
    const secondOrganizationId = await createAndSponsor(
      secondAdminCookie,
      "NewTek managed by second vendor",
    );

    const crossSponsorAttempt = await request(app)
      .post(`/implementation-a/managed-organizations/${secondOrganizationId}/workers`)
      .set("Cookie", firstAdminCookie)
      .send({ workerUserId: workerId });
    expect(crossSponsorAttempt.status).toBe(404);

    expect(firstOrganizationId).not.toBe(secondOrganizationId);
    const first = await request(app)
      .get(`/implementation-a/sponsorships?workerUserId=${workerId}`)
      .set("Cookie", firstAdminCookie);
    const second = await request(app)
      .get(`/implementation-a/sponsorships?workerUserId=${workerId}`)
      .set("Cookie", secondAdminCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toHaveLength(1);
    expect(second.body).toHaveLength(1);
    expect(first.body[0].sponsorVendorId).toBe(firstVendorId);
    expect(second.body[0].sponsorVendorId).toBe(secondVendorId);
    expect(first.body[0].id).not.toBe(second.body[0].id);
  });

  it("claims a managed company without replacing worker identities or sponsorship history", async () => {
    const managedOrganizationId = await createAndSponsor(
      firstAdminCookie,
      "NewTek identity-preserving claim",
    );
    const before = await db
      .select({ workerUserId: managedSubcontractorWorkerSponsorshipsTable.workerUserId })
      .from(managedSubcontractorWorkerSponsorshipsTable);

    const claimed = await request(app)
      .post(`/implementation-a/managed-organizations/${managedOrganizationId}/claim`)
      .set("Cookie", representativeCookie)
      .send({ representativeUserId: representativeId });

    expect(claimed.status).toBe(200);
    expect(claimed.body.claimedVendorId).toBe(claimedVendorId);
    const [organization] = await db
      .select()
      .from(managedSubcontractorOrganizationsTable);
    expect(organization).toBeDefined();
    const after = await db
      .select({ workerUserId: managedSubcontractorWorkerSponsorshipsTable.workerUserId })
      .from(managedSubcontractorWorkerSponsorshipsTable);
    expect(after.map((row) => row.workerUserId)).toEqual(
      expect.arrayContaining(before.map((row) => row.workerUserId)),
    );
    const claims = await db.select().from(managedSubcontractorClaimsTable);
    expect(claims.some((row) => row.managedOrganizationId === managedOrganizationId)).toBe(true);
  });

  it("rejects partner sponsorship and non-admin vendor mutation", async () => {
    const partnerCookie = buildTestCookie({
      userId: firstAdminId,
      role: "partner",
      partnerId: 1,
      membershipRole: "admin",
    });
    const memberCookie = buildTestCookie({
      userId: firstAdminId,
      role: "vendor",
      vendorId: firstVendorId,
      membershipRole: "member",
    });
    expect((await request(app)
      .post("/implementation-a/managed-organizations")
      .set("Cookie", partnerCookie)
      .send({ name: "Partner attempt" })).status).toBe(403);
    expect((await request(app)
      .post("/implementation-a/managed-organizations")
      .set("Cookie", memberCookie)
      .send({ name: "Member attempt" })).status).toBe(403);
  });
});
