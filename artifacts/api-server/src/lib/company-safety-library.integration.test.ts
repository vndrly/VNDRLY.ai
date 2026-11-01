import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, vendorsTable, userOrgMembershipsTable, workHubFormTemplatesTable } from "@workspace/db";
import { SAFETY_LIBRARY_REQUIREMENTS, SAFETY_LIBRARY_RESOURCE_TYPES } from "@workspace/api-zod";
import { companySafetyMaturity } from "./company-safety-maturity";

it("returns all 59 company-scoped requirements and 236 published links without credit or cross-company access", async () => {
  if (process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1") throw Error("Requires a newly provisioned isolated test database");
  // This release reads the existing assessment table; create only its fixture in the fresh test database.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS safety_maturity_assessments (org_type text NOT NULL, org_id integer NOT NULL, assessment jsonb NOT NULL, PRIMARY KEY(org_type,org_id))`);
  async function company() {
    const suffix=randomUUID();
    const [vendor]=await db.insert(vendorsTable).values({name:`Synthetic Library ${suffix}`,contactName:"Synthetic",contactEmail:`${suffix}@example.invalid`}).returning();
    const [user]=await db.insert(usersTable).values({username:suffix,displayName:"Synthetic reviewer",passwordHash:"test-only",role:"vendor"}).returning();
    const [membership]=await db.insert(userOrgMembershipsTable).values({userId:user.id,orgType:"vendor",vendorId:vendor.id,role:"admin"}).returning();
    await db.update(usersTable).set({activeMembershipId:membership.id}).where(eq(usersTable.id,user.id));
    return {vendor,user,actor:{userId:user.id,role:"vendor",membershipRole:"admin",vendorId:vendor.id,activeMembershipId:membership.id,sv:user.sessionVersion,source:"web" as const}};
  }
  const a=await company(), b=await company();
  await db.insert(workHubFormTemplatesTable).values(SAFETY_LIBRARY_REQUIREMENTS.flatMap(r=>SAFETY_LIBRARY_RESOURCE_TYPES.map(type=>{
    const id=randomUUID();
    return {id,ownerOrgType:"vendor",ownerOrgId:a.vendor.id,name:`${r.id} ${type}`,definition:[],createdById:a.user.id,
      libraryMetadata:{kind:"policy",seriesId:id,contentVersion:1,state:"published",safetyResource:{familyId:r.id,categoryId:r.category,resourceType:type,sourceVersion:"1.0",sourceSha256:"a".repeat(64)}}};
  })));
  const result=await companySafetyMaturity(a.actor);
  expect(result.categories.flatMap(c=>c.requirements)).toHaveLength(59);
  expect(result.categories.flatMap(c=>c.requirements.flatMap(r=>r.resources))).toHaveLength(236);
  expect(result.score).toBe(0);expect(result.incomplete).toBe(true);
  const other=await companySafetyMaturity(b.actor);
  expect(other.categories.flatMap(c=>c.requirements.flatMap(r=>r.resources))).toHaveLength(0);
  expect(other.score).toBe(0);
});
