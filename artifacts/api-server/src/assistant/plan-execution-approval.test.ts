import { expect, it } from "vitest";
import { createCoordinatedPlan } from "./coordinated-plan";
import { prepareBoundExecutionProposal } from "./plan-execution-approval";

function fixture() {
  const plan = createCoordinatedPlan({ userId: 17, organizationKey: "vendor:4" }, [
    { id: "read", specialist: "Ivy", toolNames: ["query_asset_custody"], dependsOn: [] },
    { id: "draft", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: ["read"],
      completion: { kind: "canonical_work_hub_task_action_saved", action: "create", title: "Custody review", assigneeUserId: 17 } },
  ]);
  const context = { requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 },
    grantReference: "bound-grant", taskId: "00000000-0000-4000-8000-000000000010", taskVersion: 3,
    availableTools: new Set(["query_asset_custody", "manage_work_hub_task"]) };
  const input = { taskId: context.taskId, expectedTaskVersion: 3, expectedPlanVersion: 1, expiresInMinutes: 30, maxAttempts: 2,
    steps: [{ id: "read", adapter: "authorized_read", toolName: "query_asset_custody", arguments: {} },
      { id: "draft", adapter: "personal_draft", toolName: "manage_work_hub_task", arguments: { title: "Custody review" } }] };
  return { plan, context, input };
}

it("derives exact dependencies, identity, expiry and operation IDs from trusted proposal context", () => {
  const f = fixture();
  const result = prepareBoundExecutionProposal(f.plan, f.context, f.input, 1000);
  expect(result.steps[1].dependsOn).toEqual(["read"]);
  expect(result.requester).toEqual(f.context.requester);
  expect(result.expiresAt).toBe(1_801_000);
  expect(new Set([...result.steps.map(step => step.operationId), result.notificationOperationId]).size).toBe(3);
});

it("refuses dropped prerequisites, stale task versions and unavailable tools", () => {
  const f = fixture();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, steps: [f.input.steps[1]] })).toThrow("prerequisite");
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, expectedTaskVersion: 2 })).toThrow("changed");
  expect(() => prepareBoundExecutionProposal(f.plan, { ...f.context, availableTools: new Set() }, f.input)).toThrow("permitted");
});

it("rejects identity injection, unsupported adapters and changed saved draft intent", () => {
  const f = fixture();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, requester: { userId: 99 } })).toThrow();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input, steps: [{ ...f.input.steps[0], adapter: "money_transfer" }] })).toThrow();
  expect(() => prepareBoundExecutionProposal(f.plan, f.context, { ...f.input,
    steps: [f.input.steps[0], { ...f.input.steps[1], arguments: { title: "Different action" } }] })).toThrow("intent");
});
it("preserves explicit candidate versions and chronology prerequisites in review without automatic batch selection",()=>{
  const plan=createCoordinatedPlan({userId:17,organizationKey:"vendor:4"},[
    {id:"candidates",specialist:"Ivy",toolNames:["query_ticket_invoice_candidates"],dependsOn:[]},
    {id:"history",specialist:"Ivy",toolNames:["query_invoice_activity"],dependsOn:[]},
    {id:"prepare",specialist:"Ivy",toolNames:["prepare_ticket_invoices"],dependsOn:["candidates","history"]},
  ]);
  const context={...fixture().context,availableTools:new Set(["query_ticket_invoice_candidates","query_invoice_activity","prepare_ticket_invoices"])};
  const selection={ticketId:100007,expectedUpdatedAt:"2026-10-07T10:00:00.123Z"};
  const input={taskId:context.taskId,expectedTaskVersion:context.taskVersion,expectedPlanVersion:plan.version,expiresInMinutes:30,maxAttempts:2,steps:[
    {id:"candidates",adapter:"authorized_read",toolName:"query_ticket_invoice_candidates",arguments:{limit:20,afterTicketId:0}},
    {id:"history",adapter:"authorized_read",toolName:"query_invoice_activity",arguments:{basis:"recorded_invoice_activity"}},
    {id:"prepare",adapter:"ticket_invoice_preparation",toolName:"prepare_ticket_invoices",arguments:{basis:"recorded_invoice_activity",tickets:[selection]}},
  ]};
  const proposal=prepareBoundExecutionProposal(plan,context,input,1000);
  expect(proposal.steps[2].arguments).toEqual({basis:"recorded_invoice_activity",tickets:[selection]});
  expect(proposal.steps[2].dependsOn).toEqual(["candidates","history"]);
  expect(proposal.steps[2].operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(()=>prepareBoundExecutionProposal(plan,context,{...input,steps:input.steps.slice(1)},1000)).toThrow("prerequisite");
  expect(()=>prepareBoundExecutionProposal(plan,context,{...input,steps:[input.steps[0],input.steps[1],{...input.steps[2],arguments:{basis:"recorded_invoice_activity",allEligible:true}}]},1000)).toThrow();
});
