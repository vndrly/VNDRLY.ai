import { z } from "zod/v4";
import { createCoordinatedPlan, encodePlanDescription, decodePlanDescription, eligiblePlanSteps } from "./coordinated-plan";
export const RESUME_PLAN_TOOL = {
 name:"v_resume_work_plan",description:"Resume a saved coordinated Work Hub plan for this connected user and company. Returns recorded checkpoints and currently available next steps; does not execute work. Recorded completion is not proof: verify referenced canonical records before reporting success.",
 inputSchema:{type:"object" as const,properties:{taskId:{type:"string",format:"uuid"}},required:["taskId"],additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
};
export function resumedWorkPlan(value:unknown,taskId:string,identity:{userId:number;organizationKey:string},availableTools:ReadonlySet<string>){
 z.string().uuid().parse(taskId);
 const envelope=z.union([z.array(z.unknown()),z.object({tasks:z.array(z.unknown())}),z.object({items:z.array(z.unknown())})]).parse(value);
 const rows=Array.isArray(envelope)?envelope:"tasks" in envelope?envelope.tasks:envelope.items;
 const candidate=rows.find(row=>!!row&&typeof row==="object"&&(row as {id?:string}).id===taskId);
 const task=z.object({id:z.string().uuid(),ownerOrgType:z.enum(["vendor","partner"]),ownerOrgId:z.number().int().positive(),version:z.number().int().positive(),description:z.string()}).parse(candidate);
 if(identity.organizationKey!==`${task.ownerOrgType}:${task.ownerOrgId}`)throw Error("Plan company mismatch");
 const plan=decodePlanDescription(task.description,identity);
 return {taskId:task.id,taskVersion:task.version,plan,eligibleStepIds:eligiblePlanSteps(plan,identity,availableTools).map(step=>step.id),executionStarted:false,recordedCompletionRequiresReadback:true};
}

export const PREPARE_PLAN_TOOL = {
 name:"v_prepare_work_plan",description:"Prepare a durable coordinated Work Hub task for several specialists. Use a stable UUID planId for retries. The user/company come from the linked account. Every requested tool must already be permitted. Saving the plan requires the existing action panel and does not start background execution.",
 inputSchema:{type:"object" as const,properties:{planId:{type:"string",format:"uuid"},title:{type:"string",maxLength:200},steps:{type:"array",minItems:1,maxItems:100,items:{type:"object",properties:{id:{type:"string"},specialist:{type:"string"},toolNames:{type:"array",items:{type:"string"}},dependsOn:{type:"array",items:{type:"string"}}},required:["id","specialist","toolNames","dependsOn"],additionalProperties:false}}},required:["planId","title","steps"],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
};
const planRequest=z.object({planId:z.string().uuid(),title:z.string().trim().min(1).max(200),steps:z.array(z.object({id:z.string().min(1).max(100),specialist:z.string().min(1).max(100),toolNames:z.array(z.string().min(1).max(150)).min(1).max(50),dependsOn:z.array(z.string().min(1).max(100)).max(100)}).strict()).min(1).max(100)}).strict();
export function prepareWorkPlan(input:unknown,identity:{userId:number;organizationKey:string},owner:{type:"vendor"|"partner";id:number},availableTools:ReadonlySet<string>){
 const request=planRequest.parse(input);
 if(identity.organizationKey!==owner.type+":"+owner.id)throw Error("Plan company mismatch");
 if(request.steps.some(step=>step.toolNames.some(tool=>!availableTools.has(tool))))throw Error("Plan requires unavailable tool");
 const plan={...createCoordinatedPlan(identity,request.steps),id:request.planId};
 return {owner,context:{kind:"organization",id:owner.id},expectedVersion:null,action:"create",payload:{title:request.title,description:encodePlanDescription(plan)}};
}

