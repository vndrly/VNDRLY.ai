import { expect, it } from "vitest";
import { createCoordinatedPlan, encodePlanDescription } from "./coordinated-plan";
import { preparePlanCompletion } from "./chatgpt-plan-completion";
import { resumedWorkPlan } from "./chatgpt-coordinated-plan";
import { verifiedPlanCompletionIds } from "./plan-completion-proof";
const identity = { userId: 17, organizationKey: "vendor:4" }, owner = { type: "vendor" as const, id: 4 }, now = Date.parse("2030-01-01T12:00:00Z"), secret = "isolated-test-secret";
function setup() {
 const plan = createCoordinatedPlan(identity, [{ id: "read", specialist: "Finn", toolNames: ["query_tickets"], dependsOn: [], completion: { kind: "planned_read_observed" } }, { id: "next", specialist: "V", toolNames: ["get_work_hub_briefing"], dependsOn: ["read"] }]);
 const task = { id: "11111111-1111-4111-8111-111111111111", ownerOrgType: "vendor", ownerOrgId: 4, version: 3, status: "in_progress", description: encodePlanDescription(plan) };
 const input = { taskId: task.id, expectedTaskVersion: 3, stepId: "read", receipt: "verified-server-envelope" };
 const receipt = { kind: "plan-read-checkpoint", id: "22222222-2222-4222-8222-222222222222", userId: 17, organizationKey: identity.organizationKey, taskId: task.id, taskVersion: 3, planVersion: 1, stepId: "read", expires: now + 300000, observedAt: new Date(now).toISOString(), observations: [{ toolName: "query_tickets", failed: false, resultHash: "a".repeat(64) }] };
 const available = new Set(["query_tickets", "get_work_hub_briefing"]);
 return { task, input, receipt, available };
}
it("requires current message read permission and exact saved text without implying delivery",()=>{
 const {task}=setup(),channelId="33333333-3333-4333-8333-333333333333",messageId="44444444-4444-4444-8444-444444444444",operationId="55555555-5555-4555-8555-555555555555",body="Review the saved ticket.";
 const plan=createCoordinatedPlan(identity,[{id:"message",specialist:"workday",toolNames:["send_work_hub_message"],dependsOn:[],completion:{kind:"canonical_work_hub_message_saved",channelId,body}}]);
 const row={...task,description:encodePlanDescription(plan)},request={taskId:task.id,expectedTaskVersion:3,stepId:"message",actionReference:"durable-action"};
 const message={id:messageId,channelId,authorUserId:identity.userId,body,kind:"text",version:1,deletedAt:null,parentMessageId:null,rootMessageId:null,clientOperationId:operationId};
 const action={state:"completed",toolName:"send_work_hub_message",executionFingerprint:"exact",arguments:{owner,channelId,body},result:JSON.stringify({operationId,appliedAt:new Date(now).toISOString(),resource:message})};
 const evidence={action,resource:{source:"vndrly",authority:"work_hub_message",channel:{id:channelId,ownerOrgType:owner.type,ownerOrgId:owner.id},message}},available=new Set(["send_work_hub_message","list_work_hub_messages"]);
 expect(()=>preparePlanCompletion([row],request,identity,owner,available,new Set(),evidence,secret,now)).toThrow("read permission");
 expect(JSON.parse(preparePlanCompletion([row],request,identity,owner,available,available,evidence,secret,now).payload.description).steps[0].detail).toContain("no delivery or readership asserted");
});
it("requires current calendar-item permission for a saved meeting checkpoint", () => {
 const {task}=setup();
 const occurrenceId="33333333-3333-4333-8333-333333333333",meetingId="44444444-4444-4444-8444-444444444444";
 const intent={kind:"canonical_work_hub_meeting_action_saved" as const,action:"create" as const,title:"Crew briefing",startsAt:"2026-10-08T12:00:00.000Z",endsAt:"2026-10-08T12:30:00.000Z",timezone:"America/Chicago"};
 const plan=createCoordinatedPlan(identity,[{id:"meeting",specialist:"workday",toolNames:["manage_work_hub_meeting"],dependsOn:[],completion:intent}]);
 const row={...task,description:encodePlanDescription(plan)};
 const resource={meeting:{id:meetingId,ownerOrgType:owner.type,ownerOrgId:owner.id,createdById:identity.userId,title:intent.title,timezone:intent.timezone},occurrence:{id:occurrenceId,meetingId,startsAt:intent.startsAt,endsAt:intent.endsAt,status:"scheduled"}};
 const action={state:"completed",toolName:"manage_work_hub_meeting",executionFingerprint:"saved-exact",arguments:{action:"create",owner,payload:{title:intent.title,startsAt:intent.startsAt,endsAt:intent.endsAt,timezone:intent.timezone}},result:JSON.stringify({operationId:meetingId,appliedAt:new Date(now).toISOString(),resource})};
 const request={taskId:task.id,expectedTaskVersion:3,stepId:"meeting",actionReference:"saved-action"};
 const available=new Set(["manage_work_hub_meeting","get_work_hub_calendar_item"]);
 const evidence={action,resource:{source:"vndrly",authority:"work_hub_meeting",item:resource}};
 expect(()=>preparePlanCompletion([row],request,identity,owner,available,new Set(),evidence,secret,now)).toThrow("read permission");
 const output=preparePlanCompletion([row],request,identity,owner,available,available,evidence,secret,now);
 expect(JSON.parse(output.payload.description).steps[0].detail).toContain("no attendance, capture or delivery asserted");
 expect(()=>preparePlanCompletion([row],request,identity,owner,available,available,{...evidence,resource:{...evidence.resource,item:{...resource,occurrence:{...resource.occurrence,status:"cancelled"}}}},secret,now)).toThrow();
});
it("saves observed reads only and unlocks exact dependencies with server proof", () => {
 const { task, input, receipt, available } = setup();
 const output = preparePlanCompletion([task], input, identity, owner, available, available, { receipt }, secret, now);
 const saved = { ...task, version: 4, description: output.payload.description };
 expect(JSON.parse(saved.description).steps[0].detail).toContain("no business action asserted");
 expect(resumedWorkPlan([saved], saved.id, identity, available, now, (id, plan) => verifiedPlanCompletionIds(secret, id, plan)).eligibleStepIds).toEqual(["next"]);
 expect(resumedWorkPlan([saved], saved.id, identity, available, now).eligibleStepIds).toEqual([]);
});
it("revalidation refuses expiry, revocation, failed reads, changed task or actor and model assertions", () => {
 const { task, input, receipt, available } = setup();
 for (const change of [{ expires: now }, { userId: 18 }, { taskVersion: 2 }, { observations: [{ ...receipt.observations[0], failed: true }] }])
  expect(() => preparePlanCompletion([task], input, identity, owner, available, available, { receipt: { ...receipt, ...change } }, secret, now)).toThrow();
 expect(() => preparePlanCompletion([{ ...task, version: 4 }], input, identity, owner, available, available, { receipt }, secret, now)).toThrow("version");
 expect(() => preparePlanCompletion([task], input, identity, owner, new Set(), new Set(), { receipt }, secret, now)).toThrow("eligible");
 expect(() => preparePlanCompletion([task], { ...input, completed: true }, identity, owner, available, available, { receipt }, secret, now)).toThrow();
});
it("forged completed task text cannot release a dependent checkpoint", () => {
 const { task, available } = setup();
 const plan = JSON.parse(task.description); plan.steps[0].state = "completed"; plan.steps[0].resultReferences = ["ticket:42"];
 expect(resumedWorkPlan([{ ...task, description: JSON.stringify(plan) }], task.id, identity, available, now, (id, saved) => verifiedPlanCompletionIds(secret, id, saved)).eligibleStepIds).toEqual([]);
});
it("saves exact created WorkHub task proof and refuses a missing task read scope", () => {
 const { task, available } = setup();
 const recordId = "33333333-3333-4333-8333-333333333333";
 const plan = createCoordinatedPlan(identity, [{ id: "create", specialist: "V", toolNames: ["manage_work_hub_task"], dependsOn: [], completion: { kind: "canonical_work_hub_task_action_saved", action: "create", title: "Follow up" } }]);
 const resource = { id: recordId, ownerOrgType: "vendor", ownerOrgId: 4, title: "Follow up", version: 1, status: "open" };
 const action = { state: "completed", toolName: "manage_work_hub_task", executionFingerprint: "saved-operation", arguments: { action: "create", owner, expectedVersion: null, payload: { title: "Follow up" } }, result: JSON.stringify({ operationId: "44444444-4444-4444-8444-444444444444", appliedAt: new Date(now).toISOString(), resource }) };
 const tasks = [{ ...task, description: encodePlanDescription(plan) }], request = { taskId: task.id, expectedTaskVersion: 3, stepId: "create", actionReference: "17.existing-action" }, tools = new Set([...available, "manage_work_hub_task", "list_work_hub_tasks"]), evidence = { action, resource: { ...resource, subjectType: "task" } };
 const output = preparePlanCompletion(tasks, request, identity, owner, tools, new Set(["list_work_hub_tasks"]), evidence, secret, now);
 expect(JSON.parse(output.payload.description).steps[0]).toMatchObject({ state: "completed", detail: expect.stringContaining("not physical-work proof") });
 expect(() => preparePlanCompletion(tasks, request, identity, owner, tools, new Set(), evidence, secret, now)).toThrow("read permission");
});

it("Gate checkpoint requires current history permission and issues only signed saved-record proof", () => {
  const plan = createCoordinatedPlan(identity, [
    {
      id: "exit",
      specialist: "Gate",
      toolNames: ["confirm_visitor_check_out"],
      dependsOn: [],
      completion: {
        kind: "canonical_gate_visit_action_saved",
        action: "check_out",
        visitId: 7,
        siteLocationId: 392,
      },
    },
  ]);
  const task = { ...setup().task, description: encodePlanDescription(plan) };
  const input = {
    taskId: task.id,
    expectedTaskVersion: 3,
    stepId: "exit",
    actionReference: "current-actor-saved-reference",
  };
  const evidence = {
    action: {
      state: "completed",
      toolName: "confirm_visitor_check_out",
      executionFingerprint: "durable",
      arguments: { visitId: 7 },
      result: JSON.stringify({
        ok: true,
        action: "visitor_checked_out",
        visitId: 7,
      }),
    },
    resource: {
      id: 7,
      siteLocationId: 392,
      firstName: "Synthetic",
      lastName: "Visitor",
      hostType: "vendor",
      hostVendorId: 4,
      hostPartnerId: null,
      checkInTime: "2030-01-01T11:00:00Z",
      checkOutTime: "2030-01-01T12:00:00Z",
      autoCheckedOut: false,
    },
  };
  const available = new Set([
    "confirm_visitor_check_out",
    "manage_work_hub_task",
  ]);
  expect(() =>
    preparePlanCompletion(
      [task],
      input,
      identity,
      owner,
      available,
      new Set(),
      evidence,
      secret,
      now,
    ),
  ).toThrow(/history/);
  const result = preparePlanCompletion(
    [task],
    input,
    identity,
    owner,
    available,
    new Set(["search_gate_history"]),
    evidence,
    secret,
    now,
  );
  const saved = JSON.parse(result.payload.description);
  expect([...verifiedPlanCompletionIds(secret, task.id, saved)]).toEqual([
    "exit",
  ]);
  expect(result.payload.description).toContain("no physical presence");
});

