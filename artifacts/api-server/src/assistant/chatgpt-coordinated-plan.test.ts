import {expect,it} from "vitest";
import {createCoordinatedPlan,encodePlanDescription} from "./coordinated-plan";
import {resumedWorkPlan} from "./chatgpt-coordinated-plan";
it('prepares safe pause, retry and cancellation with task concurrency protection',async()=>{
 const {prepareWorkPlanControl}=await import('./chatgpt-coordinated-plan');
 const identity={userId:17,organizationKey:'vendor:4'},owner={type:'vendor' as const,id:4};
 const plan=createCoordinatedPlan(identity,[{id:'review',specialist:'Finn',toolNames:['query_tickets'],dependsOn:[]}]);
 const task={id:'11111111-1111-4111-8111-111111111111',ownerOrgType:'vendor',ownerOrgId:4,version:3,status:'in_progress',description:encodePlanDescription(plan)};
 const input={taskId:task.id,expectedTaskVersion:3,stepId:'review',state:'waiting',detail:'Awaiting billing information'};
 const paused=prepareWorkPlanControl([task],input,identity,owner,new Set());
 expect(paused).toMatchObject({taskId:task.id,expectedVersion:3,action:'update',payload:{status:'in_progress'}});
 expect(JSON.parse(paused.payload.description).steps[0]).toMatchObject({state:'waiting',resultReferences:[],detail:input.detail});
 expect(()=>prepareWorkPlanControl([task],{...input,state:'completed',resultReferences:['invented']},identity,owner,new Set())).toThrow();
 expect(()=>prepareWorkPlanControl([task],{...input,expectedTaskVersion:2},identity,owner,new Set())).toThrow('version');
 expect(()=>prepareWorkPlanControl([task],{...input,state:'pending'},identity,owner,new Set())).toThrow('unavailable');
 expect(()=>prepareWorkPlanControl([{...task,status:'completed'}],input,identity,owner,new Set())).toThrow('terminal');
 expect(()=>prepareWorkPlanControl([task],input,{...identity,userId:18},owner,new Set())).toThrow('identity');
});
it("resumes only the actor's company plan and rechecks revoked tools",()=>{
 const identity={userId:17,organizationKey:"vendor:4"};const plan=createCoordinatedPlan(identity,[{id:"review",specialist:"Finn",toolNames:["query_tickets"],dependsOn:[]}]);const task={id:"11111111-1111-4111-8111-111111111111",ownerOrgType:"vendor",ownerOrgId:4,version:1,description:encodePlanDescription(plan)};
 expect(resumedWorkPlan([task],task.id,identity,new Set()).eligibleStepIds).toEqual([]);
 expect(resumedWorkPlan({tasks:[task]},task.id,identity,new Set(["query_tickets"]))).toMatchObject({eligibleStepIds:["review"],executionStarted:false,recordedCompletionRequiresReadback:true});
 expect(()=>resumedWorkPlan([task],task.id,{...identity,userId:18},new Set())).toThrow("identity");
 expect(()=>resumedWorkPlan([task],task.id,{...identity,organizationKey:"vendor:5"},new Set())).toThrow("company");
});
it("prepares an actor-bound task with stable retry contents and refuses unavailable steps", async()=>{
 const {prepareWorkPlan}=await import('./chatgpt-coordinated-plan');
 const identity={userId:17,organizationKey:'vendor:4'},owner={type:'vendor' as const,id:4};
 const input={planId:'11111111-1111-4111-8111-111111111111',title:'Morning recovery',steps:[{id:'review',specialist:'Finn',toolNames:['query_tickets'],dependsOn:[]}]};
 const a=prepareWorkPlan(input,identity,owner,new Set(['query_tickets']));
 expect(prepareWorkPlan(input,identity,owner,new Set(['query_tickets']))).toEqual(a);
 expect(JSON.parse(a.payload.description).identity).toEqual(identity);
 expect(()=>prepareWorkPlan(input,identity,owner,new Set())).toThrow('unavailable');
 expect(()=>prepareWorkPlan({...input,userId:99},identity,owner,new Set(['query_tickets']))).toThrow();
});
it('refuses a write or unrelated argument injection in a planned read',async()=>{
 const {plannedReadRequests}=await import('./chatgpt-coordinated-plan');
 const identity={userId:17,organizationKey:'vendor:4'};
 const plan=createCoordinatedPlan(identity,[{id:'review',specialist:'Finn',toolNames:['manage_ticket_record'],dependsOn:[]}]);
 const task={id:'11111111-1111-4111-8111-111111111111',ownerOrgType:'vendor',ownerOrgId:4,version:1,description:encodePlanDescription(plan)};
 const resumed=resumedWorkPlan([task],task.id,identity,new Set(['manage_ticket_record']));
 expect(()=>plannedReadRequests(resumed,'review',{manage_ticket_record:{}},new Set())).toThrow('authorization');
 const readPlan=createCoordinatedPlan(identity,[{id:'brief',specialist:'V',toolNames:['get_work_hub_briefing'],dependsOn:[]}]);
 const ready=resumedWorkPlan([{...task,description:encodePlanDescription(readPlan)}],task.id,identity,new Set(['get_work_hub_briefing']));
 expect(()=>plannedReadRequests(ready,'brief',{get_work_hub_briefing:{},query_tickets:{}},new Set(['get_work_hub_briefing']))).toThrow('planned');
 expect(()=>plannedReadRequests(ready,'foreign',{},new Set(['get_work_hub_briefing']))).toThrow('eligible');
});

