import { expect, it, vi } from "vitest";
import { createCoordinatedPlan, checkpointPlan } from "./coordinated-plan";
import { persistCoordinatedPlan, readCoordinatedPlan } from "./coordinated-plan-task-store";
it("persists and resumes through canonical task envelopes with version and operation identity", async () => {
 const identity={userId:10,organizationKey:"vendor:7"};const owner={type:"vendor" as const,id:7};
 const plan=createCoordinatedPlan(identity,[{id:"review",specialist:"Finn",toolNames:["query_tickets"],dependsOn:[]}]);
 let task:any;const request=vi.fn(async (method:string,path:string,body:any)=>{
  if(method==="GET")return [task];
  task={id:"11111111-1111-4111-8111-111111111111",ownerOrgType:"vendor",ownerOrgId:7,version:body.expectedVersion===null?1:body.expectedVersion+1,description:body.payload.description};return {resource:task};
 });
 const operationId="22222222-2222-4222-8222-222222222222";
 const saved=await persistCoordinatedPlan(request,identity,owner,plan,{operationId,title:"Recovery plan",expectedVersion:null});
 expect(saved.plan).toEqual(plan);
 expect(request.mock.calls[0][2]).toMatchObject({operationId,expectedVersion:null,owner,context:{kind:"organization",id:7}});
 const resumed=await readCoordinatedPlan(request,identity,owner,saved.task.id);expect(resumed.plan).toEqual(plan);
 const next=checkpointPlan(plan,identity,1,"review",{state:"completed",resultReferences:["ticket:123"]});
 await persistCoordinatedPlan(request,identity,owner,next,{operationId:"33333333-3333-4333-8333-333333333333",taskId:saved.task.id,expectedVersion:1});
 expect(request.mock.calls[2][0]).toBe("PATCH");expect(request.mock.calls[2][2].expectedVersion).toBe(1);
});
it("refuses cross-company storage before making a request", async()=>{
 const identity={userId:10,organizationKey:"vendor:7"};const plan=createCoordinatedPlan(identity,[{id:"a",specialist:"V",toolNames:["query_tickets"],dependsOn:[]}]);const request=vi.fn();
 await expect(persistCoordinatedPlan(request,identity,{type:"vendor",id:8},plan,{operationId:"22222222-2222-4222-8222-222222222222",title:"Plan",expectedVersion:null})).rejects.toThrow("identity");expect(request).not.toHaveBeenCalled();
});

