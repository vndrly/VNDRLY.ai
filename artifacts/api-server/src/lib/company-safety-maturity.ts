import {repositoryCertificationProgress} from '../work-hub/repository-certifications';
import { and, eq, sql } from "drizzle-orm";
import { db, workHubFormTemplatesTable as templates } from "@workspace/db";
import { projectSafetyMaturity, maturityResourceTitle, MATURITY_RESOURCE_TYPES, LibraryMetadataSchema, type WorkHubOwner } from "@workspace/api-zod";
import { safetyRequirementLinks } from "./safety-library-links";
import { libraryAuthority, type LibraryActor } from "../work-hub/library-core";
import {companyRequiredTraining, trainingCatalog}from'./company-required-training';
import { storedTrainingProjection } from '../work-hub/stored-training-projections';
import { applySafetyTrainingScore } from './safety-training-score';

export async function companySafetyScoreSummary(owner: WorkHubOwner, options: { optimized?: boolean } = {}) {
 return storedTrainingProjection(`${owner.type}:${owner.id}:safety-summary`, async () => {
  const [assessment, training, coverage] = await Promise.all([
    db.execute(sql`SELECT assessment AS record FROM safety_maturity_assessments WHERE org_type=${owner.type} AND org_id=${owner.id} LIMIT 1`),
    repositoryCertificationProgress(db, owner, null, options.optimized ? { ...options, bonusOnly: true } : options),
    companyRequiredTraining(db,owner),
  ]);
  const result = applySafetyTrainingScore(projectSafetyMaturity((assessment.rows[0] as { record?: unknown } | undefined)?.record),coverage);
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
  const training=await companyRequiredTraining(db,owner);
  const result = applySafetyTrainingScore(projectSafetyMaturity(row?.record),training);
  const augmented=await repositoryCertificationProgress(db,owner);
  // Built only by the projection worker from the company's service/role requirements.
  const gaps = new Map<string, number>();
  for (const requirement of training.requirements) {
    if (!requirement.completed) gaps.set(requirement.familyId, (gaps.get(requirement.familyId) ?? 0) + 1);
  }
  const recommendations = [...gaps].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,2).map(([familyId, remaining]) => ({
    familyId, remaining, title: trainingCatalog.curriculum.find(course => course.id === familyId)?.title ?? familyId,
    courseId: training.items.get(familyId)?.record.id ?? null,
  }));
  return { ...result, recommendations, baseScore:result.score, bonusScore:augmented.bonusScore, combinedScore:Math.min(110,result.score+augmented.bonusScore),bonusCompleted:augmented.bonusCompleted,bonusRequired:augmented.bonusRequired, categories: result.categories.map(category => ({ ...category, resources: MATURITY_RESOURCE_TYPES.flatMap(type => {
    const resource = published.find(item => item.title === maturityResourceTitle(category.id, type));
    return resource ? [{ id: resource.id, title: type }] : [];
  }), requirements: safetyRequirementLinks(category.id, resources).map(r=>{const required=training.requirements.filter(item=>item.familyId===r.id),course=training.items.get(r.id);return {...r,resources:r.resources.map(resource=>resource.type==='training'&&course?{...resource,id:course.record.id}:resource),trainingRequirement:{required:required.length,completed:required.filter(item=>item.completed).length}};}) })) };
 });
}
