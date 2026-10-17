import {z} from "zod/v4";
import {WorkdayScopeSchema,WorkdayCommandSchema} from "./workday";
import {FleetCanonicalIdSchema,FleetTimeZoneSchema,FleetDetailSnapshotSchema,FleetDetailSaveSchema,FleetRigPackageSaveSchema} from "./fleet-details";
import {FleetRoutePlanSchema} from "./fleet-route";
import {FleetRunOrderSaveSchema} from "./fleet-run-order";
import {FleetDestinationSaveSchema} from "./fleet-commercial";
import {FleetPricingIntentSchema,FleetQuantityEvidenceSchema} from "./fleet-pricing";
import {FleetActionPolicySnapshotSchema} from "./fleet-action-policy";
import {FleetCompliancePolicySchema,FleetComplianceSubjectSchema} from "./fleet-compliance";
import {FleetActionInputSchema} from "./fleet";
import {FleetComplianceSaveSchema,FleetComplianceVerifySchema,FleetComplianceFactsSaveSchema,FleetComplianceRequirementAdoptSchema} from "./fleet-compliance-register";

const uuid=FleetCanonicalIdSchema,id=z.number().int().positive(),revision=z.number().int().positive(),timestamp=z.iso.datetime({offset:true});
/** Claimed original context; B2 must compare with verified session/provisioning.
 * No role, permission, or model-generated authorization is accepted here. */
export const FleetWorkScopeSchema=WorkdayScopeSchema.extend({deviceId:z.string().trim().min(1).max(200),provisioningId:uuid}).strict();
export type FleetWorkScope=z.infer<typeof FleetWorkScopeSchema>;
const uuidKinds=["activity","run_order","detail","rig_package","location","evidence","shift"] as const;
export const FleetWorkReferenceSchema=z.union([
 z.object({type:z.literal("local"),kind:z.enum(["ticket",...uuidKinds]),id:uuid}).strict(),
 z.object({type:z.literal("canonical"),kind:z.literal("ticket"),id,version:revision}).strict(),
 z.object({type:z.literal("canonical"),kind:z.enum(uuidKinds),id:uuid,version:revision}).strict(),
]);
export type FleetWorkReference=z.infer<typeof FleetWorkReferenceSchema>;
const reference=(kind:FleetWorkReference["kind"])=>FleetWorkReferenceSchema.refine(value=>value.kind===kind,`An exact ${kind} reference is required`);
export const FleetWorkTicketReferenceSchema=reference("ticket");
const activityRef=reference("activity");
export function fleetWorkReferenceLabel(input:unknown):string{
 const value=FleetWorkReferenceSchema.parse(input);
 if(value.type==="local")return value.kind==="ticket"?"Local ticket — pending sync":`Local ${value.kind.replaceAll("_"," ")} — pending sync`;
 return value.kind==="ticket"?`Ticket #${value.id}`:`${value.kind.replaceAll("_"," ")} ${value.id}`;
}
export const FleetWorkBillingIntentSchema=z.object({
 choice:z.enum(["new_ticket","existing_ticket"]),ticket:FleetWorkTicketReferenceSchema,
 partnerId:id.nullable(),billingSiteId:id.nullable(),afeNumber:z.string().max(200),workDate:z.iso.date(),currency:z.literal("USD"),
 serviceId:id.nullable(),agreementReference:z.string().trim().min(1).max(500).nullable(),
}).strict().superRefine((value,ctx)=>{
 if(value.choice==="new_ticket"&&value.ticket.type!=="local")ctx.addIssue({code:"custom",path:["ticket"],message:"A new offline ticket needs its own local identity"});
});
const base={version:z.literal(2),operationId:uuid,scope:FleetWorkScopeSchema,capturedAt:timestamp,timeZone:FleetTimeZoneSchema,dependencies:z.array(uuid)};
const capturedCompliance=FleetActionPolicySnapshotSchema.omit({mode:true}).extend({mode:FleetCompliancePolicySchema.shape.mode}).strict();
const media={byteSize:z.number().int().positive().max(10*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),contentType:z.enum(["image/jpeg","image/png","image/webp","application/pdf"])};
const activityCreate=z.object({...base,kind:z.literal("activity.create"),payload:z.object({
 activityId:uuid,title:z.string().trim().min(1).max(200),detailReference:reference("detail"),detailSnapshot:FleetDetailSnapshotSchema,
 route:FleetRoutePlanSchema,runOrderReference:reference("run_order").nullable(),billing:FleetWorkBillingIntentSchema,
 pricingIntent:FleetPricingIntentSchema,capturePolicy:FleetCompliancePolicySchema.nullable(),compliance:capturedCompliance,
}).strict()}).strict();
const note=z.object({...base,kind:z.literal("activity.note"),payload:z.object({activity:activityRef,ticket:FleetWorkTicketReferenceSchema,notes:z.string().trim().min(1).max(4000)}).strict()}).strict();
const action=z.object({...base,kind:z.literal("activity.action"),payload:z.object({activity:activityRef,ticket:FleetWorkTicketReferenceSchema,baseAssignment:FleetDetailSnapshotSchema,action:FleetActionInputSchema}).strict()}).strict();
const command=<K extends string,T extends z.ZodType>(kind:K,payload:T)=>z.object({...base,kind:z.literal(kind),payload}).strict();
export const FleetWorkCommandSchema=z.discriminatedUnion("kind",[
 activityCreate,note,action,
 command("detail.save",FleetDetailSaveSchema),command("rig_package.save",FleetRigPackageSaveSchema),
 command("run_order.save",FleetRunOrderSaveSchema),command("location.save",FleetDestinationSaveSchema),
 command("compliance.receive",z.object({source:FleetComplianceSaveSchema,documentReference:reference("evidence").nullable()}).strict()),command("compliance.review",FleetComplianceVerifySchema),
 command("compliance.document.stage",z.object({recordId:uuid,subject:FleetComplianceSubjectSchema,expectedRecordVersion:z.number().int().nonnegative(),evidence:reference("evidence"),...media}).strict()),
 command("compliance.facts",FleetComplianceFactsSaveSchema),command("requirements.adopt",FleetComplianceRequirementAdoptSchema),
 command("workday.event",WorkdayCommandSchema),
 command("quantity.record",z.object({activity:activityRef,ticket:FleetWorkTicketReferenceSchema,evidence:FleetQuantityEvidenceSchema}).strict()),
 command("ticket.finalize",z.object({ticket:FleetWorkTicketReferenceSchema,expectedVersion:revision}).strict()),
 command("evidence.stage",z.object({evidence:reference("evidence"),activity:activityRef,ticket:FleetWorkTicketReferenceSchema,kind:z.enum(["photo","scale","receipt","signature"]),...media,notes:z.string().max(2000),assignment:FleetDetailSnapshotSchema}).strict()),
]).superRefine((value,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:"custom",message});
 if(new Set(value.dependencies).size!==value.dependencies.length||value.dependencies.includes(value.operationId))issue("Dependencies must be unique other operation identities");
 if(value.kind!=="workday.event"&&value.scope.owner.type!=="vendor")issue("Fleet work requires the original vendor company context");
 if(value.kind==="activity.create"){
   const p=value.payload;
   if(p.detailSnapshot.detail.companyId!==value.scope.owner.id||p.detailSnapshot.carrierOfRecordId!==value.scope.owner.id||p.detailReference.id!==p.detailSnapshot.detail.id)issue("The exact Detail identity and original company must agree");
   if(p.detailReference.type==="canonical"&&p.detailReference.version!==p.detailSnapshot.detail.version)issue("The exact Detail revision must agree");
   if(Date.parse(p.compliance.evaluatedAt)>Date.parse(value.capturedAt))issue("Capture cannot use a future compliance assessment");
   if(!p.capturePolicy&&(p.compliance.status!=="red"||p.compliance.mode!=="warn_only"))issue("An unresolved capture policy cannot assert clearance or enforcement");
   if(p.capturePolicy){
     const policy=p.capturePolicy;
     if(policy.mode!==p.compliance.mode||policy.scope.partnerId!==p.billing.partnerId||(policy.scope.siteId!==null&&policy.scope.siteId!==p.billing.billingSiteId)||(policy.scope.workTypeId!==null&&policy.scope.workTypeId!==p.billing.serviceId)||Date.parse(policy.effectiveFrom)>Date.parse(value.capturedAt)||(policy.effectiveUntil!==null&&Date.parse(policy.effectiveUntil)<=Date.parse(value.capturedAt)))issue("Capture must retain the actually applicable policy scope and version");
   }
 }
 if("operationId" in value.payload&&value.payload.operationId!==value.operationId)issue("Nested operation identity differs from the original intent");
 if(value.kind==="compliance.receive"&&value.payload.source.operationId!==value.operationId)issue("Source receipt identity differs from the original intent");
 if(value.kind==="workday.event"){
   const p=value.payload;
   if(p.scope.userId!==value.scope.userId||p.scope.membershipId!==value.scope.membershipId||p.scope.sessionVersion!==value.scope.sessionVersion||p.scope.owner.type!==value.scope.owner.type||p.scope.owner.id!==value.scope.owner.id||p.capturedAt!==value.capturedAt||p.timezone!==value.timeZone)issue("Shift intent must retain the same worker, employer, session and captured time");
 }
 if(value.kind==="activity.action"){
   const p=value.payload;
   if(p.action.operationId!==value.operationId||(p.action.capturedAt&&p.action.capturedAt!==value.capturedAt)||p.baseAssignment.detail.companyId!==value.scope.owner.id)issue("Action must retain original operation, capture and assignment scope");
   if(["acknowledge","inspect","start","arrive_stop","depart_stop","record_load","record_delivery","submit_closeout"].includes(p.action.action)&&p.baseAssignment.detail.driverUserId!==value.scope.userId)issue("Dispatch cannot impersonate the driver's physical actions");
 }
 if(value.kind==="quantity.record"&&(value.payload.evidence.recordedByUserId!==value.scope.userId||value.payload.evidence.capturedAt!==value.capturedAt))issue("Quantity evidence must retain its actual recorder and captured time");
 if(value.kind==="detail.save"&&value.payload.detail.companyId!==value.scope.owner.id)issue("Detail belongs to another original company");
 if(value.kind==="rig_package.save"&&value.payload.package.companyId!==value.scope.owner.id)issue("Rig package belongs to another original company");
 if(value.kind==="run_order.save"&&value.payload.order.companyId!==value.scope.owner.id)issue("Run order belongs to another original company");
});
export type FleetWorkCommand=z.infer<typeof FleetWorkCommandSchema>;
export const FleetWorkCanonicalReferenceSchema=z.union([FleetWorkReferenceSchema.options[1],FleetWorkReferenceSchema.options[2]]);
export const FleetWorkMappingSchema=z.object({local:FleetWorkReferenceSchema.options[0],canonical:FleetWorkCanonicalReferenceSchema}).strict().superRefine((value,ctx)=>{if(value.local.kind!==value.canonical.kind)ctx.addIssue({code:"custom",message:"A mapping cannot change resource kind"});});
export const FleetWorkReconciliationReasonSchema=z.enum(["closed_ticket","changed_assignment","resource_conflict","missing_authority","unresolved_location","unresolved_price","expired_session","invalid_dependency","invalid_command","stale_revision","temporarily_unavailable","storage_unavailable"]);
const receiptBase={version:z.literal(2),operationId:uuid,scope:FleetWorkScopeSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),recordedAt:timestamp};
const applied={...receiptBase,mappings:z.array(FleetWorkMappingSchema),canonicalReferences:z.array(FleetWorkCanonicalReferenceSchema)};
export const FleetWorkReceiptSchema=z.discriminatedUnion("status",[
 z.object({...applied,status:z.literal("applied")}).strict(),z.object({...applied,status:z.literal("duplicate")}).strict(),
 z.object({...receiptBase,status:z.literal("needs_reconciliation"),reason:FleetWorkReconciliationReasonSchema,caseId:uuid}).strict(),
 z.object({...receiptBase,status:z.literal("denied"),reason:FleetWorkReconciliationReasonSchema,caseId:uuid.nullable()}).strict(),
 z.object({...receiptBase,status:z.literal("retry_later"),reason:FleetWorkReconciliationReasonSchema,retryAt:timestamp}).strict(),
]);
export type FleetWorkReceipt=z.infer<typeof FleetWorkReceiptSchema>;
export const FleetReconciliationCaseSchema=z.object({id:uuid,version:revision,scope:FleetWorkScopeSchema,operationId:uuid,reason:FleetWorkReconciliationReasonSchema,originalReferences:z.array(FleetWorkReferenceSchema),allowedResolutions:z.array(z.enum(["link_open_ticket","create_ticket","correct_assignment","resolve_location","resolve_price","renew_authority","retain_record_only"])),createdAt:timestamp}).strict();
/** A persistence adapter emits this only after its actual durable transaction. */
export const FleetLocalSaveReceiptSchema=z.object({operationId:uuid,storedAt:timestamp,durability:z.literal("durable"),canonicalApplied:z.literal(false)}).strict();
export type FleetLocalSaveReceipt=z.infer<typeof FleetLocalSaveReceiptSchema>;
export const FLEET_WORK_RETENTION_FLOORS=Object.freeze({days:7,activities:100,events:5000,photos:500});
export type FleetWorkJournal={
 append(command:FleetWorkCommand):Promise<FleetLocalSaveReceipt>;
 appendFact(command:Extract<FleetWorkCommand,{kind:"activity.note"|"activity.action"|"evidence.stage"|"quantity.record"|"workday.event"}>):Promise<FleetLocalSaveReceipt>;
 listPending(scope:FleetWorkScope,after?:number):Promise<{commands:FleetWorkCommand[];nextCursor:number|null}>;
 readMappings(scope:FleetWorkScope,ids:string[]):Promise<z.infer<typeof FleetWorkMappingSchema>[]>;
 applyReceipt(scope:FleetWorkScope,receipt:FleetWorkReceipt):Promise<void>;
 readStatus(scope:FleetWorkScope):Promise<{pending:number;needsReconciliation:number;pendingEvidence:number;locked:boolean}>;
 lockScope(scope:FleetWorkScope):Promise<void>;
};
