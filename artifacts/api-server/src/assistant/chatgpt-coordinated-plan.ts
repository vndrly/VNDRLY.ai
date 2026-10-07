import { z } from "zod/v4";
import { createCoordinatedPlan, encodePlanDescription, decodePlanDescription, eligiblePlanSteps, checkpointPlan, overduePlanStepIds } from "./coordinated-plan";
export const RESUME_PLAN_TOOL = {
 name:"v_resume_work_plan",description:"Resume a saved coordinated Work Hub plan for this connected user and company. Returns recorded checkpoints and currently available next steps; does not execute work. Recorded completion is not proof: verify referenced canonical records before reporting success.",
 inputSchema:{type:"object" as const,properties:{taskId:{type:"string",format:"uuid"}},required:["taskId"],additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
};
export function resumedWorkPlan(value:unknown,taskId:string,identity:{userId:number;organizationKey:string},availableTools:ReadonlySet<string>,now=Date.now()){
 z.string().uuid().parse(taskId);
 const envelope=z.union([z.array(z.unknown()),z.object({tasks:z.array(z.unknown())}),z.object({items:z.array(z.unknown())})]).parse(value);
 const rows=Array.isArray(envelope)?envelope:"tasks" in envelope?envelope.tasks:envelope.items;
 const candidate=rows.find(row=>!!row&&typeof row==="object"&&(row as {id?:string}).id===taskId);
 const task=z.object({id:z.string().uuid(),ownerOrgType:z.enum(["vendor","partner"]),ownerOrgId:z.number().int().positive(),version:z.number().int().positive(),description:z.string(),status:z.enum(['open','in_progress','completed','cancelled']).optional()}).parse(candidate);
 if(identity.organizationKey!==`${task.ownerOrgType}:${task.ownerOrgId}`)throw Error("Plan company mismatch");
 const plan=decodePlanDescription(task.description,identity);
 const terminal=task.status==='completed'||task.status==='cancelled';
 return {taskId:task.id,taskVersion:task.version,taskStatus:task.status,plan,eligibleStepIds:terminal?[]:eligiblePlanSteps(plan,identity,availableTools).map(step=>step.id),overdueStepIds:overduePlanStepIds(plan,identity,now),executionStarted:false,recordedCompletionRequiresReadback:true};
}
export const CONTROL_PLAN_TOOL = {
 name:'v_prepare_work_plan_control',description:'Prepare pausing, retrying or cancelling one saved plan step through the existing Work Hub authorization panel. Supply the last fetched task version. Does not mark work completed, execute a step or cancel an already-running external action. Retry rechecks current tools; completed and cancelled steps cannot be restarted.',
 inputSchema:{type:'object' as const,properties:{taskId:{type:'string',format:'uuid'},expectedTaskVersion:{type:'integer',minimum:1},stepId:{type:'string'},state:{type:'string',enum:['pending','waiting','cancelled']},detail:{type:'string',maxLength:2000}},required:['taskId','expectedTaskVersion','stepId','state'],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false},
};
export function prepareWorkPlanControl(value:unknown,input:unknown,identity:{userId:number;organizationKey:string},owner:{type:'vendor'|'partner';id:number},availableTools:ReadonlySet<string>){
 const request=z.object({taskId:z.string().uuid(),expectedTaskVersion:z.number().int().positive(),stepId:z.string().min(1).max(100),state:z.enum(['pending','waiting','cancelled']),detail:z.string().max(2000).optional()}).strict().parse(input);
 if(identity.organizationKey!==owner.type+':'+owner.id)throw Error('Plan company mismatch');
 const resumed=resumedWorkPlan(value,request.taskId,identity,availableTools);
 if(resumed.taskVersion!==request.expectedTaskVersion)throw Error('Task version changed');
 if(!resumed.taskStatus||['completed','cancelled'].includes(resumed.taskStatus))throw Error('Plan task is terminal or status unavailable');
 const step=resumed.plan.steps.find(step=>step.id===request.stepId);
 if(!step)throw Error('Unknown plan step');
 if(request.state==='pending'&&step.toolNames.some(name=>!availableTools.has(name)))throw Error('Plan requires unavailable tool');
 const plan=checkpointPlan(resumed.plan,identity,resumed.plan.version,request.stepId,{state:request.state,resultReferences:[],detail:request.detail});
 return {owner,context:{kind:'organization',id:owner.id},taskId:request.taskId,expectedVersion:request.expectedTaskVersion,action:'update',payload:{status:resumed.taskStatus,description:encodePlanDescription(plan)}};
}

export const PREPARE_PLAN_TOOL = {
 name:"v_prepare_work_plan",description:"Prepare a durable coordinated Work Hub task for several specialists. Use a stable UUID planId for retries. The user/company come from the linked account. Every requested tool must already be permitted. Saving the plan requires the existing action panel and does not start background execution.",
 inputSchema:{type:"object" as const,properties:{planId:{type:"string",format:"uuid"},title:{type:"string",maxLength:200},steps:{type:"array",minItems:1,maxItems:100,items:{type:"object",properties:{id:{type:"string"},specialist:{type:"string"},toolNames:{type:"array",items:{type:"string"}},dependsOn:{type:"array",items:{type:"string"}},deadlineAt:{type:"string",format:"date-time",description:"Resolved UTC deadline; saving it does not schedule execution"}},required:["id","specialist","toolNames","dependsOn"],additionalProperties:false}}},required:["planId","title","steps"],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
};
const planRequest=z.object({planId:z.string().uuid(),title:z.string().trim().min(1).max(200),steps:z.array(z.object({id:z.string().min(1).max(100),specialist:z.string().min(1).max(100),toolNames:z.array(z.string().min(1).max(150)).min(1).max(50),dependsOn:z.array(z.string().min(1).max(100)).max(100),deadlineAt:z.string().datetime().optional()}).strict()).min(1).max(100)}).strict();
export function prepareWorkPlan(input:unknown,identity:{userId:number;organizationKey:string},owner:{type:"vendor"|"partner";id:number},availableTools:ReadonlySet<string>){
 const request=planRequest.parse(input);
 if(identity.organizationKey!==owner.type+":"+owner.id)throw Error("Plan company mismatch");
 if(request.steps.some(step=>step.toolNames.some(tool=>!availableTools.has(tool))))throw Error("Plan requires unavailable tool");
 const plan={...createCoordinatedPlan(identity,request.steps),id:request.planId};
 return {owner,context:{kind:"organization",id:owner.id},expectedVersion:null,action:"create",payload:{title:request.title,description:encodePlanDescription(plan)}};
}
export const RUN_PLAN_READ_TOOL = {
 name:'v_run_work_plan_read',description:'Run the currently authorized read tools for one eligible step in a saved coordinated plan. Does not execute writes, start monitoring, or save a completion checkpoint. Return actual results and preserve errors.',
 inputSchema:{type:'object' as const,properties:{taskId:{type:'string',format:'uuid'},stepId:{type:'string'},toolArguments:{type:'object',description:'Map from each planned read tool name to its arguments'}},required:['taskId','stepId','toolArguments'],additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true},
};
export function plannedReadRequests(resumed:ReturnType<typeof resumedWorkPlan>,stepId:string,argumentsByTool:unknown,readTools:ReadonlySet<string>){
 if(resumed.taskStatus==='completed'||resumed.taskStatus==='cancelled')throw Error('Plan task is terminal');
 if(!resumed.eligibleStepIds.includes(stepId))throw Error('Plan step not eligible');
 const step=resumed.plan.steps.find(step=>step.id===stepId)!;
 if(step.toolNames.some(name=>!readTools.has(name)))throw Error('Step requires an action authorization');
 const args=z.record(z.string(),z.record(z.string(),z.unknown())).parse(argumentsByTool);
 if(Object.keys(args).some(name=>!step.toolNames.includes(name))||step.toolNames.some(name=>!(name in args)))throw Error('Supply arguments only for the planned read tools');
 return [...new Set(step.toolNames)].map(name=>({name,arguments:args[name]}));
}
