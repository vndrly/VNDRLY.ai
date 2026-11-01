import { and, eq, sql } from "drizzle-orm";
import { db, workHubFormTemplatesTable as templates } from "@workspace/db";
import { projectSafetyMaturity, maturityResourceTitle, MATURITY_RESOURCE_TYPES, LibraryMetadataSchema } from "@workspace/api-zod";
import { safetyRequirementLinks } from "./safety-library-links";
import { libraryAuthority, type LibraryActor } from "../work-hub/library-core";

export async function companySafetyMaturity(actor: LibraryActor) {
  const { owner } = await libraryAuthority(db, actor);
  const assessment = await db.execute(sql`SELECT assessment AS record FROM safety_maturity_assessments WHERE org_type=${owner.type} AND org_id=${owner.id} LIMIT 1`);
  const row = assessment.rows[0] as { record?: unknown } | undefined;
  const resources = await db.select({ id: templates.id, title: templates.name, metadata: templates.libraryMetadata }).from(templates).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id)));
  const published = resources.flatMap(resource => {
    const parsed = LibraryMetadataSchema.safeParse(resource.metadata);
    return parsed.success && parsed.data.state === "published" ? [{ ...resource, metadata: parsed.data }] : [];
  });
  const result = projectSafetyMaturity(row?.record);
  return { ...result, categories: result.categories.map(category => ({ ...category, resources: MATURITY_RESOURCE_TYPES.flatMap(type => {
    const resource = published.find(item => item.title === maturityResourceTitle(category.id, type));
    return resource ? [{ id: resource.id, title: type }] : [];
  }), requirements: safetyRequirementLinks(category.id, resources) })) };
}
