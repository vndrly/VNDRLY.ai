import {expect,it} from "vitest";
import {createCoordinatedPlan,encodePlanDescription} from "./coordinated-plan";
import {resumedWorkPlan} from "./chatgpt-coordinated-plan";
it("resumes only the actor's company plan and rechecks revoked tools",()=>{
 const identity={userId:17,organizationKey:"vendor:4"};const plan=createCoordinatedPlan(identity,[{id:"review",specialist:"Finn",toolNames:["query_tickets"],dependsOn:[]}]);const task={id:"11111111-1111-4111-8111-111111111111",ownerOrgType:"vendor",ownerOrgId:4,version:1,description:encodePlanDescription(plan)};
 expect(resumedWorkPlan([task],task.id,identity,new Set()).eligibleStepIds).toEqual([]);
 expect(resumedWorkPlan({tasks:[task]},task.id,identity,new Set(["query_tickets"]))).toMatchObject({eligibleStepIds:["review"],executionStarted:false,recordedCompletionRequiresReadback:true});
 expect(()=>resumedWorkPlan([task],task.id,{...identity,userId:18},new Set())).toThrow("identity");
 expect(()=>resumedWorkPlan([task],task.id,{...identity,organizationKey:"vendor:5"},new Set())).toThrow("company");
});

