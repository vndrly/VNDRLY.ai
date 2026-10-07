import {expect,it,vi} from "vitest";
import {createPlanCalendarResponsesRead} from "./plan-execution-calendar-responses";
import {calendarSnapshotFingerprint} from "../services/calendar-reschedule";
import type {PlanExecutionAuthorization,PlanExecutionStep} from "./plan-execution";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const step:PlanExecutionStep={id:"responses",adapter:"authorized_read",toolName:"query_work_hub_meeting_responses",operationId:id(3),dependsOn:[],arguments:{occurrenceId:id(1)}};
const authorization:PlanExecutionAuthorization={id:id(4),requester:{userId:9,organizationKey:"vendor:4",membershipId:5,sessionVersion:1},grantReference:"private",taskId:id(5),taskVersion:1,planId:id(6),planVersion:1,planFingerprint:"a".repeat(64),approvedAt:1,expiresAt:90000,maxAttempts:1,steps:[step],notificationOperationId:id(7)};
function fixture(){
 const snapshot={occurrenceId:id(1),meetingId:id(2),ownerType:"vendor" as const,ownerId:4,title:"Meeting",agenda:"Private agenda",timezone:"UTC",createdById:9,startsAt:"2026-10-07T10:00:00Z",endsAt:"2026-10-07T11:00:00Z",status:"scheduled" as const,participantUserIds:[9,10]};
 const output={snapshot,fingerprint:calendarSnapshotFingerprint(snapshot),actorUserId:9,canManage:false,responses:[{userId:9,response:"unknown" as const,recordedResponse:"accepted" as const,scheduleResponseVerified:false,recordedAt:null}],source:"saved_work_hub_participant_response",physicalAttendanceVerified:false,externalAttendeeAcceptanceVerified:false};
 const authorize=vi.fn(async()=>({session:{userId:9,role:"vendor",vendorId:4,activeMembershipId:5,sv:1},scopes:["work_hub:read"],current:{...authorization.requester,grantReference:"private",grantRevoked:false,taskId:id(5),taskVersion:1,planId:id(6),planVersion:1,planFingerprint:authorization.planFingerprint,availableTools:[step.toolName]}}));
 const request=vi.fn(async():Promise<unknown>=>output);
 return {output,authorize,request,run:createPlanCalendarResponsesRead({authorize,request})};
}
it("observes exact saved responses without exposing agenda or treating legacy acceptance as verified",async()=>{
 const f=fixture(),result=await f.run(authorization,step),summary=JSON.parse(result.summary);
 expect(f.request).toHaveBeenCalledWith(`/work-hub/calendar-response/${id(1)}/snapshot`,"GET",{},expect.objectContaining({userId:9}));
 expect(f.authorize).toHaveBeenCalledTimes(2);expect(result.summary).not.toContain("Private agenda");expect(summary.savedReplyCounts).toEqual({accepted:0,declined:0,pending:0,unknown:1});expect(summary.physicalAttendanceVerified).toBe(false);
});
it("refuses altered approved reads and removed consent before a request",async()=>{
 const f=fixture();await expect(f.run(authorization,{...step,arguments:{occurrenceId:id(99)}})).rejects.toThrow("not approved");
 const current=await f.authorize();f.authorize.mockResolvedValue({...current,scopes:[]});await expect(f.run(authorization,step)).rejects.toThrow("unavailable");expect(f.request).not.toHaveBeenCalled();
});
it("refuses foreign response rows, malformed fingerprints and authority loss after reading",async()=>{
 const f=fixture();f.request.mockResolvedValueOnce({...f.output,responses:[{...f.output.responses[0],userId:10}]});await expect(f.run(authorization,step)).rejects.toThrow("scope");
 f.request.mockResolvedValueOnce({...f.output,fingerprint:"b".repeat(64)});await expect(f.run(authorization,step)).rejects.toThrow("scope");
 const current=await f.authorize();f.authorize.mockResolvedValueOnce(current).mockRejectedValueOnce(Error("revoked"));await expect(f.run(authorization,step)).rejects.toThrow("revoked");
});
