import { describe, expect, it } from "vitest";
import { savedWorkHubMeetingResourceId, verifySavedWorkHubMeetingCompletion } from "./plan-work-hub-meeting-proof";
const id="5a7313fc-c78b-48d4-93b2-83fcd52d7c75", meetingId="885f5954-39f4-4f87-a73c-a9afaa2ee044";
const schedule={title:"Crew briefing",startsAt:"2026-10-08T12:00:00.000Z",endsAt:"2026-10-08T12:30:00.000Z",timezone:"America/Chicago"};
const meeting={id:meetingId,ownerOrgType:"vendor",ownerOrgId:1107,createdById:1072,title:schedule.title,timezone:schedule.timezone};
const occurrence={id,meetingId,startsAt:schedule.startsAt,endsAt:schedule.endsAt,status:"scheduled"};
const resource={meeting,occurrence};
const action={state:"completed",toolName:"manage_work_hub_meeting",executionFingerprint:"durable-exact",arguments:{action:"create",owner:{type:"vendor",id:1107},payload:schedule},result:JSON.stringify({operationId:meetingId,appliedAt:"2026-10-07T12:00:00.000Z",resource})};
const identity={userId:1072,organizationKey:"vendor:1107"};
const step={id:"briefing",specialist:"workday",dependsOn:[],toolNames:["manage_work_hub_meeting"],completion:{kind:"canonical_work_hub_meeting_action_saved" as const,action:"create" as const,...schedule}};
describe("saved meeting action proof",()=>{
 it("checks exact saved creation and fresh authorized occurrence without inventing a version",()=>{
  expect(savedWorkHubMeetingResourceId(action)).toBe(id);
  expect(verifySavedWorkHubMeetingCompletion(step,action,{source:"vndrly",authority:"work_hub_meeting",item:resource},identity).resourceId).toBe(id);
 });
 it("refuses pending, substituted owner/occurrence/schedule, changed state and missing canonical read",()=>{
  for(const bad of [{...action,state:"pending"},{...action,toolName:"manage_work_hub_task"},{...action,result:JSON.stringify({error:"failed"})}])expect(()=>verifySavedWorkHubMeetingCompletion(step,bad,{source:"vndrly",authority:"work_hub_meeting",item:resource},identity)).toThrow();
  for(const item of [{...resource,meeting:{...meeting,ownerOrgId:999}},{...resource,occurrence:{...occurrence,id:meetingId}},{...resource,occurrence:{...occurrence,startsAt:"2026-10-08T13:00:00.000Z"}},{...resource,occurrence:{...occurrence,status:"cancelled"}}])expect(()=>verifySavedWorkHubMeetingCompletion(step,action,{source:"vndrly",authority:"work_hub_meeting",item},identity)).toThrow();
  expect(()=>verifySavedWorkHubMeetingCompletion(step,action,undefined,identity)).toThrow();
 });
 it("requires exact saved cancel and current cancelled occurrence; no capture or attendance assertion",()=>{
  const cancelled={...resource,occurrence:{...occurrence,status:"cancelled"}};
  const cancel={...action,arguments:{...action.arguments,action:"cancel",occurrenceId:id,payload:{}},result:JSON.stringify({operationId:meetingId,appliedAt:"2026-10-07T12:00:00.000Z",resource:cancelled})};
  const intent={...step,completion:{kind:"canonical_work_hub_meeting_action_saved" as const,action:"cancel" as const,occurrenceId:id}};
  expect(verifySavedWorkHubMeetingCompletion(intent,cancel,{source:"vndrly",authority:"work_hub_meeting",item:cancelled},identity).resourceId).toBe(id);
  expect(()=>verifySavedWorkHubMeetingCompletion(intent,cancel,{source:"vndrly",authority:"work_hub_meeting",item:resource},identity)).toThrow();
 });
});
