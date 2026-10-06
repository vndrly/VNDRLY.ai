import { z } from "zod/v4";
import { decodePlanDescription, eligiblePlanSteps } from "./coordinated-plan";
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

