import { z } from "zod/v4";
export const CompanySafetyReadinessSchema = z.object({
 version: z.literal(1), score: z.number(), maximumScore: z.number(), provisional: z.boolean(), incidentScore: z.number(), incidentPoints: z.number(), readinessPoints: z.number(), readinessWeight: z.number(), incidentWeight: z.number(), activePeople: z.number(), canManage: z.boolean(), asOf: z.string(),
 categories: z.array(z.object({id: z.enum(["training","acknowledgements","credentials","drivers","inspections","correctiveActions"]), completed: z.number(), required: z.number(), unknown: z.number(), outstanding: z.number(), points: z.number(), maximumPoints: z.number(), provisional: z.boolean()})),
});
export type CompanySafetyReadiness = z.infer<typeof CompanySafetyReadinessSchema>;
