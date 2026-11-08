import {repositoryCertificationProgress} from '../work-hub/repository-certifications';
import { and, eq, sql } from "drizzle-orm";
import { db, workHubFormTemplatesTable as templates } from "@workspace/db";
import { projectSafetyMaturity, maturityResourceTitle, MATURITY_RESOURCE_TYPES, LibraryMetadataSchema, type WorkHubOwner } from "@workspace/api-zod";
import { safetyRequirementLinks } from "./safety-library-links";
import { libraryAuthority, type LibraryActor } from "../work-hub/library-core";
import {companyRequiredTraining}from'./company-required-training';
import { storedTrainingProjection } from '../work-hub/stored-training-projections';

export async function companySafetyScoreSummary(owner: WorkHubOwner, options: { optimized?: boolean } = {}) {
 return storedTrainingProjection(`${owner.type}:${owner.id}:safety-summary`, async () => {
  const [assessment, training] = await Promise.all([
    db.execute(sql`SELECT assessment AS record FROM safety_maturity_assessments WHERE org_type=${owner.type} AND org_id=${owner.id} LIMIT 1`),
    repositoryCertificationProgress(db, owner, null, options.optimized ? { ...options, bonusOnly: true } : options),
  ]);
  const result = projectSafetyMaturity((assessment.rows[0] as { record?: unknown } | undefined)?.record);
  return { score: Math.min(110, result.score + training.bonusScore), maximum: 110, bonus: training.bonusScore, incomplete: result.incomplete };
 });
}

export async function companySafetyMaturity(actor: LibraryActor) {
  const { owner } = await libraryAuthority(db, actor);
  return storedCompanySafetyMaturity(owner);
}

/** Owner-only entry point for the projection worker; ordinary callers only read saved data. */
export async function storedCompanySafetyMaturity(owner: WorkHubOwner) {
 return storedTrainingProjection(`${owner.type}:${owner.id}:maturity`, async () => {
  const assessment = await db.execute(sql`SELECT assessment AS record FROM safety_maturity_assessments WHERE org_type=${owner.type} AND org_id=${owner.id} LIMIT 1`);
  const row = assessment.rows[0] as { record?: unknown } | undefined;
  const resources = await db.select({ id: templates.id, title: templates.name, metadata: sql<unknown>`${templates.libraryMetadata}-'content'-'fileSnapshots'-'trainingPolicy'` }).from(templates).where(and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id)));
  const published = resources.flatMap(resource => {
    const parsed = LibraryMetadataSchema.safeParse(resource.metadata);
    return parsed.success && parsed.data.state === "published" ? [{ ...resource, metadata: parsed.data }] : [];
  });
  const result = projectSafetyMaturity(row?.record);
  const training=await companyRequiredTraining(db,owner);
  const augmented=await repositoryCertificationProgress(db,owner);
  return { ...result, baseScore:result.score, bonusScore:augmented.bonusScore, combinedScore:Math.min(110,result.score+augmented.bonusScore),bonusCompleted:augmented.bonusCompleted,bonusRequired:augmented.bonusRequired, categories: result.categories.map(category => ({ ...category, resources: MATURITY_RESOURCE_TYPES.flatMap(type => {
    const resource = published.find(item => item.title === maturityResourceTitle(category.id, type));
    return resource ? [{ id: resource.id, title: type }] : [];
  }), requirements: safetyRequirementLinks(category.id, resources).map(r=>{const required=training.requirements.filter(item=>item.familyId===r.id),course=training.items.get(r.id);return {...r,resources:r.resources.map(resource=>resource.type==='training'&&course?{...resource,id:course.record.id}:resource),trainingRequirement:{required:required.length,completed:required.filter(item=>item.completed).length}};}) })) };
 });
}
