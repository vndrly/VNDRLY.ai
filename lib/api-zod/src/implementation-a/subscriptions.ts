import { z } from "zod/v4";

export const WorkerPlanSchema = z.enum(["gate_only", "full_worker"]);
export const WorkerSubscriptionStateSchema = z.enum(["active", "paused", "terminated"]);

export const PreviewWorkerSubscriptionSchema = z.object({
  email: z.email().transform((value) => value.trim().toLocaleLowerCase("en-US")),
  displayName: z.string().trim().min(1).max(160),
  managedOrganizationId: z.string().uuid(),
  authorizationVersion: z.string().trim().min(1).max(100),
  plan: WorkerPlanSchema,
  monthlyPriceCents: z.number().int().nonnegative(),
  renewalAt: z.iso.datetime(),
  foundingSiteLocationId: z.number().int().positive().nullable().optional(),
  previewAccess: z.boolean().default(false),
}).strict();

export const ActivateWorkerSubscriptionSchema = PreviewWorkerSubscriptionSchema.extend({
  confirmed: z.literal(true),
});

export const ReactivateWorkerSubscriptionSchema = z.object({
  renewalAt: z.iso.datetime(),
  confirmed: z.literal(true),
}).strict();

export type PreviewWorkerSubscriptionInput = z.infer<typeof PreviewWorkerSubscriptionSchema>;
export type ActivateWorkerSubscriptionInput = z.infer<typeof ActivateWorkerSubscriptionSchema>;
