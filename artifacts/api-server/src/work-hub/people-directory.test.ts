import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  db,
  partnersTable,
  partnerVendorRelationshipsTable,
  userOrgMembershipsTable,
  usersTable,
  vendorsTable,
} from "@workspace/db";
import {
  listEligibleWorkHubPeople,
  resolveWorkHubInviteEligibility,
  type WorkHubDirectoryActor,
} from "./people-directory";

describe.skipIf(process.env.VNDRLY_ISOLATED_TEST_DB !== "1")(
  "relationship-scoped Work Hub people directory",
  () => {
    let actor: WorkHubDirectoryActor;
    let sameCompanyId: number;
    let approvedPartnerId: number;
    let pendingPartnerId: number;
    let unrelatedPartnerId: number;

    beforeAll(async () => {
      const suffix = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: `Directory Vendor ${suffix}`,
          contactName: "Directory Vendor",
          contactEmail: `vendor.${suffix}@example.invalid`,
        })
        .returning();
      const partners = await db
        .insert(partnersTable)
        .values(
          ["Approved", "Pending", "Unrelated"].map((label) => ({
            name: `${label} Partner ${suffix}`,
            contactName: `${label} Contact`,
            contactEmail: `${label.toLowerCase()}.${suffix}@example.invalid`,
          })),
        )
        .returning();
      const people = await db
        .insert(usersTable)
        .values(
          [
            ["Directory Actor", "actor"],
            ["Same Company", "same"],
            ["Approved Person", "approved.person"],
            ["Pending Person", "pending.person"],
            ["Unrelated Person", "unrelated.person"],
          ].map(([displayName, local]) => ({
            username: `${local}.${suffix}@example.invalid`,
            email: `${local}.${suffix}@example.invalid`,
            displayName,
            passwordHash: "unused-test-hash",
            role: "vendor",
          })),
        )
        .returning();
      const [actorUser, sameCompany, approvedPerson, pendingPerson, unrelatedPerson] = people;
      sameCompanyId = sameCompany!.id;
      approvedPartnerId = approvedPerson!.id;
      pendingPartnerId = pendingPerson!.id;
      unrelatedPartnerId = unrelatedPerson!.id;
      actor = {
        userId: actorUser!.id,
        role: "vendor",
        vendorId: vendor!.id,
        partnerId: null,
        membershipRole: "admin",
      };
      await db.insert(userOrgMembershipsTable).values([
        { userId: actorUser!.id, orgType: "vendor", vendorId: vendor!.id, role: "admin" },
        { userId: sameCompany!.id, orgType: "vendor", vendorId: vendor!.id, role: "member" },
        { userId: approvedPerson!.id, orgType: "partner", partnerId: partners[0]!.id, role: "admin" },
        { userId: pendingPerson!.id, orgType: "partner", partnerId: partners[1]!.id, role: "member" },
        { userId: unrelatedPerson!.id, orgType: "partner", partnerId: partners[2]!.id, role: "member" },
      ]);
      await db.insert(partnerVendorRelationshipsTable).values([
        { vendorId: vendor!.id, partnerId: partners[0]!.id, status: "approved" },
        { vendorId: vendor!.id, partnerId: partners[1]!.id, status: "pending_review" },
      ]);
    });

    it("returns same-company and approved-related people without exposing email", async () => {
      const results = await listEligibleWorkHubPeople(actor, "");
      expect(results.map((person) => person.id)).toEqual(
        expect.arrayContaining([sameCompanyId, approvedPartnerId]),
      );
      expect(results.map((person) => person.id)).not.toEqual(
        expect.arrayContaining([pendingPartnerId, unrelatedPartnerId]),
      );
      expect(results.find((person) => person.id === approvedPartnerId)).toMatchObject({
        displayName: "Approved Person",
        organizationType: "partner",
        role: "admin",
        sameCompany: false,
      });
      expect(results.every((person) => !("email" in person))).toBe(true);
    });

    it("can match an eligible person by email without returning the email", async () => {
      const [result] = await listEligibleWorkHubPeople(actor, "approved.person");
      expect(result?.id).toBe(approvedPartnerId);
      expect(result).not.toHaveProperty("email");
    });

    it("revalidates eligibility before an invitation mutation", async () => {
      await expect(resolveWorkHubInviteEligibility(actor, approvedPartnerId)).resolves.toEqual({
        sameCompany: false,
        relationshipScoped: true,
      });
      await expect(resolveWorkHubInviteEligibility(actor, unrelatedPartnerId)).rejects.toThrow();
    });
  },
);
