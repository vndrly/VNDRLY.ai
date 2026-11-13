import { z } from "zod/v4";

export const MATURITY_CATEGORIES = [
  { id: "leadership", weight: 15 },
  { id: "hazards", weight: 25 },
  { id: "competence", weight: 20 },
  { id: "equipment", weight: 15 },
  { id: "learning", weight: 15 },
  { id: "emergency", weight: 10 },
] as const;
export const SafetyMaturityRecordSchema = z.object({
  version: z.literal(1),
  demo: z.boolean(),
  assessedAt: z.iso.datetime(),
  categories: z.array(z.object({
    id: z.enum(["leadership", "hazards", "competence", "equipment", "learning", "emergency"]),
    level: z.number().int().min(0).max(4),
    evidence: z.string(),
  })).length(6),
}).refine(record => new Set(record.categories.map(c => c.id)).size === 6, "Duplicate maturity categories");
export type SafetyMaturityRecord = z.infer<typeof SafetyMaturityRecordSchema>;
export const MATURITY_RESOURCE_LABELS: Record<string, string> = {
  leadership: "Leadership and worker participation", hazards: "Hazard identification and controls",
  competence: "Competence and authorization", equipment: "Equipment and operational readiness",
  learning: "Incident response and learning", emergency: "Emergency preparedness and improvement",
};
export const MATURITY_RESOURCE_TYPES = ["Program template", "Evidence form", "Preparation training", "Evidence guide"] as const;
export function maturityResourceTitle(category: string, type: string) {
  return `${MATURITY_RESOURCE_LABELS[category]} — ${type}`;
}

/** Transition only: real evidence is unassessed until the review workflow is implemented.
 * Stored demonstration records must never become verified real-company evidence. */
export function projectSafetyMaturity(raw: unknown) {
  const parsed = SafetyMaturityRecordSchema.safeParse(raw);
  const demo = parsed.success && parsed.data.demo;
  const categories = MATURITY_CATEGORIES.map(category => {
    const example = demo ? parsed.data.categories.find(c => c.id === category.id) : undefined;
    const level = example?.level ?? 0;
    return { ...category, level, points: category.weight * level / 4, evidence: example?.evidence ?? null };
  });
  return {
    version: 1 as const, demo, incomplete: !demo || categories.some(c => c.level === 0),
    score: categories.reduce((sum, c) => sum + c.points, 0),
    assessedAt: parsed.success ? parsed.data.assessedAt : null,
    categories,
  };
}
export const SafetyMaturitySummarySchema = z.object({
  version: z.literal(1), demo: z.boolean(), incomplete: z.boolean(), score: z.number(),
  baseScore:z.number().optional(),bonusScore:z.number().min(0).max(10).default(0),combinedScore:z.number().max(110).optional(),bonusCompleted:z.number().default(0),bonusRequired:z.number().default(0),
  assessedAt: z.string().nullable(),
  recommendations: z.array(z.object({ familyId: z.string(), title: z.string(), remaining: z.number(), courseId: z.string().nullable() })).default([]),
  trainingPoints:z.number().min(0).max(10).default(0),trainingRequired:z.number().default(0),trainingCompleted:z.number().default(0),trainingProvisional:z.boolean().default(true),
  categories: z.array(z.object({
    id: z.string(), weight: z.number(), level: z.number(), points: z.number(), evidence: z.string().nullable(),
    resources: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
    requirements: z.array(z.object({
      id: z.string(), title: z.string(), applicability: z.string(),
      trainingRequirement: z.object({required:z.number(),completed:z.number()}).optional(),
      resources: z.array(z.object({ id: z.string(), title: z.string(), type: z.enum(["policy", "form", "training", "evidence-examples"]) })),
    })).default([]),
  })),
});
