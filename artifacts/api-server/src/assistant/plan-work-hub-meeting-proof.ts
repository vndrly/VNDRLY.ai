import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PlanIdentity, PlanStepInput } from "./coordinated-plan";
const resourceSchema=z.object({meeting:z.object({id:z.string().uuid(),ownerOrgType:z.enum(["vendor","partner"]),ownerOrgId:z.number().int().positive(),createdById:z.number().int().positive(),title:z.string(),timezone:z.string()}).passthrough(),occurrence:z.object({id:z.string().uuid(),meetingId:z.string().uuid(),startsAt:z.string().datetime(),endsAt:z.string().datetime().nullable(),status:z.string()}).passthrough()});
function savedMeetingAction(value:unknown){
 const action=z.object({state:z.literal("completed"),toolName:z.literal("manage_work_hub_meeting"),executionFingerprint:z.string().min(1),arguments:z.object({action:z.enum(["create","cancel"]),owner:z.object({type:z.enum(["vendor","partner"]),id:z.number().int().positive()}),occurrenceId:z.string().uuid().optional(),payload:z.record(z.string(),z.unknown())}),result:z.string()}).parse(value);
 const receipt=z.object({operationId:z.string().uuid(),appliedAt:z.string().datetime(),resource:resourceSchema}).passthrough().parse(JSON.parse(action.result));
 if(receipt.error||receipt.ok===false)throw Error("Saved meeting action failed");
 return {action,receipt};
}
export function savedWorkHubMeetingResourceId(value:unknown){return savedMeetingAction(value).receipt.resource.occurrence.id;}
/** Meeting records have no canonical revision field. Check exact saved/current outcome without inventing one. */
export function verifySavedWorkHubMeetingCompletion(step:PlanStepInput,actionValue:unknown,currentValue:unknown,identity:PlanIdentity){
 if(step.completion?.kind!=="canonical_work_hub_meeting_action_saved"||step.toolNames.length!==1||step.toolNames[0]!=="manage_work_hub_meeting")throw Error("Unsupported meeting intent");
 const desired=step.completion,{action,receipt}=savedMeetingAction(actionValue);
 const current=z.object({source:z.literal("vndrly"),authority:z.literal("work_hub_meeting"),item:resourceSchema}).parse(currentValue).item;
 const saved=receipt.resource;
 if(action.arguments.action!==desired.action||`${action.arguments.owner.type}:${action.arguments.owner.id}`!==identity.organizationKey||[saved,current].some(r=>`${r.meeting.ownerOrgType}:${r.meeting.ownerOrgId}`!==identity.organizationKey||r.occurrence.meetingId!==r.meeting.id)||saved.meeting.id!==current.meeting.id||saved.occurrence.id!==current.occurrence.id)throw Error("Meeting resource identity mismatch");
 const sameTime=(a:string|null|undefined,b:unknown)=>a===null?b===null:typeof a==='string'&&typeof b==='string'&&Date.parse(a)===Date.parse(b);
 if(desired.action==='create'){
  if(saved.meeting.createdById!==identity.userId||current.meeting.createdById!==identity.userId||[saved,current].some(r=>r.occurrence.status!=='scheduled'||r.meeting.title!==desired.title||r.meeting.timezone!==desired.timezone||!sameTime(r.occurrence.startsAt,desired.startsAt)||!sameTime(r.occurrence.endsAt,desired.endsAt))||action.arguments.payload.title!==desired.title||action.arguments.payload.timezone!==desired.timezone||!sameTime(desired.startsAt,action.arguments.payload.startsAt)||!sameTime(desired.endsAt,action.arguments.payload.endsAt))throw Error("Meeting creation outcome mismatch");
 }else if(desired.occurrenceId!==current.occurrence.id||action.arguments.occurrenceId!==desired.occurrenceId||saved.occurrence.status!=='cancelled'||current.occurrence.status!=='cancelled')throw Error("Meeting cancellation not saved");
 return {resourceId:current.occurrence.id,operationId:receipt.operationId,evidenceHash:createHash("sha256").update(JSON.stringify({executionFingerprint:action.executionFingerprint,arguments:action.arguments,receipt,current})).digest("hex")};
}
