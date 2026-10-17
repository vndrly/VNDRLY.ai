import {z} from "zod/v4";
import {FleetQuantityEvidenceSchema,FleetQuantityReviewSchema,FleetChargeSchema,FleetRunBillingV2Schema} from "./fleet-pricing";
export const FleetCommercialReviewInputSchema=z.object({activityId:z.uuid(),after:z.string().regex(/^[1-9]\d{0,17}$/).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
export const FleetCommercialReviewSchema=z.object({
 activityId:z.uuid(),activityVersion:z.number().int().positive(),canReview:z.boolean(),
 ticket:z.object({id:z.number().int().positive(),version:z.number().int().positive(),status:z.string()}).strict(),
 billing:FleetRunBillingV2Schema.nullable(),charges:z.array(FleetChargeSchema),
 quantities:z.array(z.object({evidence:FleetQuantityEvidenceSchema,originalActivityVersion:z.number().int().positive(),capturedAt:z.iso.datetime({offset:true}),receivedAt:z.iso.datetime({offset:true}),timeZone:z.string(),clockStatus:z.enum(["ahead_of_server","reported_capture_time"]),review:FleetQuantityReviewSchema.nullable()}).strict()).max(100),nextCursor:z.string().nullable(),
}).strict();
export type FleetCommercialReview=z.infer<typeof FleetCommercialReviewSchema>;
