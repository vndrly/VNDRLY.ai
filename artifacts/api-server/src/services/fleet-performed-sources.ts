import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {z} from "zod/v4";
import {FleetRunSchema,FleetWorkScopeSchema,FleetWorkReferenceSchema,FleetDetailSnapshotSchema,FleetWorkReceiptSchema,type FleetWorkCommand} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import type {FleetWorkExecution} from "./fleet-work";
import {prepareFleetRecoverySourcePlan} from "./fleet-recovery-sources";
import {attachFleetBillingV2} from "./fleet-billing-v2";
import {assessFleetActionPolicy,requireFleetRunCommercialAuthority} from "./fleet-commercial-authority";
import {appendFleetRunEvent} from "./fleet-run-events";
import {FleetError} from "./fleet-repository";

export const FleetPerformedSourceBindingSchema=z.object({version:z.literal(2),scope:FleetWorkScopeSchema,originalActivity:FleetWorkReferenceSchema,originalTicket:FleetWorkReferenceSchema,rootOperationId:z.uuid(),activityId:z.uuid(),activityVersion:z.literal(1),ticketId:z.number().int().positive(),snapshot:FleetDetailSnapshotSchema,sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),caseId:z.uuid(),adoptedByUserId:z.number().int().positive(),adoptedAt:z.iso.datetime()}).strict();
export const fleetPerformedSourceBindingKey=(scope:z.infer<typeof FleetWorkScopeSchema>,id:string)=>`${scope.provisioningId}:activity:${id}`;
async function append(context:FleetWorkExecutionContext,type:string,id:string,value:unknown,userId=context.actor.userId){await context.client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_source_adoption','source-qualified-association',$3,$4,$5::jsonb,'completed')",[userId,context.actor.companyId,type,id,JSON.stringify(value)]);}

/** Enclosed by the current office command/vendor transaction. Adopt a genuinely
 * retained CLOSE REPORT into billing; never dispatch, reserve resources, replay
 * driver transitions or claim the original work was physically verified. */
export async function adoptFleetPerformedSources(context:FleetWorkExecutionContext,command:Extract<FleetWorkCommand,{kind:"activity.reconcile"}>):Promise<FleetWorkExecution>{
 const {actor,state,client}=context,p=command.payload,resolution=p.resolution;
 if(resolution.kind!=="adopt_performed")throw new FleetError("fleet.case_resolution_forbidden",409);
 const prepared=await prepareFleetRecoverySourcePlan(context,p.caseId),{plan,qualification,snapshot,original,value,sources}=prepared,root=original.command;
 if(actor.readOnly||!state.enabled||value.resolution||value.version!==p.expectedVersion)throw new FleetError("fleet.case_version_conflict",409);
 if(root.kind!=="activity.create"||p.activity.type!=="local"||p.activity.id!==root.payload.activityId||!isDeepStrictEqual(p.originalTicket,root.payload.billing.ticket))throw new FleetError("fleet.original_identity_conflict",409);
 if(plan.fingerprint!==resolution.sourceFingerprint)throw new FleetError("fleet.source_plan_changed",409);
 if(plan.status!=="closed_reports_ready_for_review"||!qualification.projection||!qualification.reportedClosedAt)throw new FleetError("fleet.recovery_requires_source_review",409);
 const grant=state.grants.find(g=>g.userId===actor.userId),group=state.fleets.find(g=>g.id===prepared.base.fleetId),billing=resolution.billing;
 if(!grant?.financeRead||!grant.roles.some(r=>r==="fleet_manager"||r==="dispatcher")||!group||!grant.fleetIds.includes(group.id)||!grant.siteIds.includes(billing.billingSiteId??0)||!group.siteIds.includes(billing.billingSiteId??0))throw new FleetError("fleet.finance_required",403);
 // Recovery changes only the explicitly selected parent ticket. It cannot
 // silently rebill another customer, site, AFE, service or work date.
 for(const key of ["partnerId","billingSiteId","afeNumber","workDate","currency"] as const)if(billing[key]!==root.payload.billing[key])throw new FleetError("fleet.billing_ticket_mismatch",409);
 if(root.payload.billing.serviceId!==null&&billing.serviceId!==root.payload.billing.serviceId)throw new FleetError("fleet.billing_ticket_mismatch",409);
 const originalActivity={type:"local" as const,kind:"activity" as const,id:root.payload.activityId},key=fleetPerformedSourceBindingKey(value.scope,originalActivity.id);
 const existing=(await client.query("SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND ((target_type='fleet-performed-source-binding' AND target_id=$2) OR (target_type='fleet-work-mapping' AND target_id=$3)) LIMIT 1",[actor.companyId,key,`${value.scope.provisioningId}:activity:${originalActivity.id}`])).rows;
 if(existing.length)throw new FleetError("fleet.source_already_adopted",409);
 for(const source of sources){
  const used=(await client.query("SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-performed-source-operation' AND target_id=$2 LIMIT 1",[actor.companyId,source.command.operationId])).rows;
  if(used.length)throw new FleetError("fleet.source_already_adopted",409);
  const receipt=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type IN ('fleet-work-operation','fleet-work-resolution-receipt') AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,source.command.operationId])).rows[0]?.tool_output;
  if(receipt){const saved=FleetWorkReceiptSchema.parse(receipt);if(saved.fingerprint!==source.fingerprint||!isDeepStrictEqual(saved.scope,source.command.scope)||["applied","duplicate","retained"].includes(saved.status))throw new FleetError("fleet.source_already_adopted",409);}
 }
 const adoptedAt=new Date().toISOString(),id=randomUUID(),{localWork:_local,resourceAssignment:_reservation,billing:_oldBilling,billingV2:_oldV2,commercial:_commercial,eventHistory:_archive,assignmentRecordedAt:_assignment,...historical}=prepared.base;
 const run=FleetRunSchema.parse({...historical,id,version:1,status:"submitted_for_review",phase:null,currentStopId:null,visitedStopIds:qualification.projection.visitedStopIds,...qualification.reports,events:[],linkedTicketId:null,allowedActions:[],recoveredWork:{version:2,billingOnly:true,physicalProofVerified:false,caseId:value.id,sourceFingerprint:plan.fingerprint,sourceCount:plan.sourceCount,snapshot,reportedClosedAt:qualification.reportedClosedAt,adoptedAt,adoptedByUserId:actor.userId}});
 const parent=await attachFleetBillingV2(context,run,billing,{workAt:root.capturedAt,pricingIntent:root.payload.pricingIntent});
 await requireFleetRunCommercialAuthority(client,run,"office_submit");
 // Current server policy governs adoption. Client capture dates cannot grant a
 // historical exemption or pretend a current reservation existed earlier.
 const policy=await assessFleetActionPolicy(client,actor,{run,action:"office_submit",policyAt:adoptedAt,requiredCertifications:group.requiredCertifications});
 appendFleetRunEvent(run,{id:randomUUID(),operationId:command.operationId,type:"historical_billing_source_adopted",actorUserId:actor.userId,recordedAt:adoptedAt,capturedAt:new Date(root.capturedAt).toISOString(),source:"user_report",details:{reason:p.reason,caseId:value.id,sourceFingerprint:plan.fingerprint,sourceCount:plan.sourceCount,reportedClosedAt:qualification.reportedClosedAt,physicalProofVerified:false,fleetCompliance:policy}});
 appendFleetRunEvent(run,{id:randomUUID(),operationId:command.operationId,type:"historical_compliance_unverified",actorUserId:actor.userId,recordedAt:adoptedAt,capturedAt:new Date(root.capturedAt).toISOString(),source:"user_report",details:{caseId:value.id,fleetCompliance:{mode:"warn_only",status:"red",evaluatedAt:adoptedAt,warnings:[{category:"regulatory_review",reason:"unverified"}]}}});
 const binding=FleetPerformedSourceBindingSchema.parse({version:2,scope:value.scope,originalActivity,originalTicket:root.payload.billing.ticket,rootOperationId:root.operationId,activityId:id,activityVersion:1,ticketId:parent.ticketId,snapshot,sourceFingerprint:plan.fingerprint,caseId:value.id,adoptedByUserId:actor.userId,adoptedAt});
 await append(context,"fleet-performed-source-binding",key,binding);
 for(const source of sources){
  const c=source.command;
  await append(context,"fleet-performed-source-operation",c.operationId,{version:2,activityId:id,bindingKey:key,operationId:c.operationId,fingerprint:source.fingerprint,kind:c.kind,capturedAt:c.capturedAt,receivedAt:source.receivedAt,timeZone:c.timeZone,reportedByUserId:c.scope.userId});
  if(c.kind==="quantity.record"){
   const prior=(await client.query("SELECT id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity' AND target_id=$2 LIMIT 1",[actor.companyId,c.payload.evidence.id])).rows;if(prior.length)throw new FleetError("fleet.source_already_adopted",409);
   await append(context,"fleet-work-quantity",c.payload.evidence.id,{version:2,scope:c.scope,operationId:c.operationId,fingerprint:source.fingerprint,activityId:id,activityVersion:1,ticketId:parent.ticketId,assignment:snapshot,evidence:c.payload.evidence,capturedAt:c.capturedAt,timeZone:c.timeZone,receivedAt:source.receivedAt,clockStatus:"reported_capture_time",officeReviewRequired:true,quantitySourceVerified:false},c.scope.userId);
  }
  // Evidence has an independent byte/association acknowledgement. Preserve it
  // pending so the original device can upload through the explicit binding.
  if(c.kind!=="evidence.stage")await append(context,"fleet-work-resolution-receipt",c.operationId,FleetWorkReceiptSchema.parse({version:2,operationId:c.operationId,scope:c.scope,fingerprint:source.fingerprint,recordedAt:adoptedAt,status:"retained",reason:value.reason,caseId:value.id,resolution:{caseId:value.id,officeOperationId:command.operationId,reviewedByUserId:actor.userId,reason:p.reason}}),c.scope.userId);
 }
 state.runs.push(run);
 return {canonicalReferences:[{type:"canonical",kind:"activity",id,version:1},{type:"canonical",kind:"ticket",id:parent.ticketId,version:parent.ticketVersion}],mappings:[]};
}
