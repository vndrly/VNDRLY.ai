import {z} from "zod/v4";
import {FleetCompliancePolicySchema} from "./fleet-compliance";

export const FleetPolicyProposalSchema=z.object({
 policyId:z.uuid().nullable(),mode:z.enum(["warn_only","enforced"]),
 scope:z.object({partnerId:z.number().int().positive(),siteId:z.number().int().positive().nullable(),contractId:z.string().min(1).max(200).nullable(),workTypeId:z.number().int().positive().nullable()}).strict(),
 effectiveFrom:z.iso.datetime({offset:true}),effectiveUntil:z.iso.datetime({offset:true}).nullable(),
 checkpoints:z.array(z.enum(["detail","reservation","dispatch","accept","start","replace","route_change","close","office_submit"])).min(1).max(9).refine(values=>new Set(values).size===values.length,"Checkpoints must be distinct"),
 notice:z.string().trim().min(1).max(2000),existingWorkTreatment:z.enum(["preserve_capture_policy","review_existing"]),
}).strict().superRefine((value,ctx)=>{if(value.effectiveUntil&&Date.parse(value.effectiveUntil)<=Date.parse(value.effectiveFrom))ctx.addIssue({code:"custom",path:["effectiveUntil"],message:"Policy end must follow start"});});
export const FleetPolicyChangeSchema=z.object({operationId:z.uuid(),expectedVersion:z.number().int().nonnegative(),proposal:FleetPolicyProposalSchema}).strict();
export const FleetPolicyConfigurationSchema=z.object({version:z.number().int().nonnegative(),policies:z.array(FleetCompliancePolicySchema).max(1000)}).strict();
export const FleetPolicyImpactSchema=z.object({version:z.number().int().nonnegative(),mode:z.enum(["warn_only","enforced"]),existingActivities:z.number().int().nonnegative(),currentlyRed:z.number().int().nonnegative(),evaluatedAt:z.iso.datetime(),basis:z.literal("recorded_checkpoints_only"),existingWorkTreatment:z.enum(["preserve_capture_policy","review_existing"])}).strict();
export const FleetPolicyActivationSchema=z.object({version:z.number().int().positive(),operationId:z.uuid(),policy:FleetCompliancePolicySchema}).strict();
