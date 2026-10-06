import { z } from "zod/v4";
import { decodePlanDescription, encodePlanDescription, type CoordinatedPlan, type PlanIdentity } from "./coordinated-plan";
type Owner={type:"vendor"|"partner";id:number};
export type CanonicalTaskRequest=(method:"GET"|"POST"|"PATCH",path:string,body?:unknown)=>Promise<unknown>;
const storedTask=z.object({id:z.string().uuid(),ownerOrgType:z.enum(["vendor","partner"]),ownerOrgId:z.number().int().positive(),version:z.number().int().positive(),description:z.string()});
function assertOwner(identity:PlanIdentity,owner:Owner){if(identity.organizationKey!==owner.type+":"+owner.id)throw Error("Plan owner identity mismatch");}
function decodeTask(value:unknown,identity:PlanIdentity,owner:Owner){const task=storedTask.parse(value);if(task.ownerOrgType!==owner.type||task.ownerOrgId!==owner.id)throw Error("Stored task owner identity mismatch");return {task,plan:decodePlanDescription(task.description,identity)};}
/** request must execute canonical task routes under the current authenticated actor; never an admin proxy. */
export async function readCoordinatedPlan(request:CanonicalTaskRequest,identity:PlanIdentity,owner:Owner,taskId:string){
 assertOwner(identity,owner);z.string().uuid().parse(taskId);
 const value=await request("GET","/work-hub/tasks");
 const rows=Array.isArray(value)?value:(value as {tasks?:unknown[];items?:unknown[]})?.tasks??(value as {items?:unknown[]})?.items??[];
 const task=rows.find(row=>(row as {id?:string})?.id===taskId);if(!task)throw Error("Plan task not found in authorized records");
 return decodeTask(task,identity,owner);
}
/** Existing Work Hub commands supply transactional permission, retry, and expectedVersion protection. */
export async function persistCoordinatedPlan(request:CanonicalTaskRequest,identity:PlanIdentity,owner:Owner,plan:CoordinatedPlan,input:{operationId:string;taskId?:string;expectedVersion:number|null;title?:string}){
 assertOwner(identity,owner);const description=encodePlanDescription(plan);decodePlanDescription(description,identity);z.string().uuid().parse(input.operationId);
 if(input.taskId){z.string().uuid().parse(input.taskId);z.number().int().positive().parse(input.expectedVersion);}else{if(input.expectedVersion!==null)throw Error("New plan requires null task version");z.string().trim().min(1).max(200).parse(input.title);}
 const body={operationId:input.operationId,owner,context:{kind:"organization",id:owner.id},expectedVersion:input.expectedVersion,payloadVersion:1,payload:{description,...(!input.taskId?{title:input.title}: {})}};
 const result=await request(input.taskId?"PATCH":"POST",input.taskId?"/work-hub/tasks/"+input.taskId:"/work-hub/tasks",body);
 const saved=decodeTask((result as {resource?:unknown})?.resource,identity,owner);
 if(saved.plan.id!==plan.id||encodePlanDescription(saved.plan)!==description)throw Error("Saved plan readback mismatch");
 return saved;
}

