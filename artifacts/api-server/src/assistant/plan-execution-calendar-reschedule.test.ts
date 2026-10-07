import { expect,it,vi } from "vitest";
import { createPlanCalendarReschedule,type CalendarExecutionAuthorization,type CalendarExecutionStep } from "./plan-execution-calendar-reschedule";
import { calendarRescheduleRequest,CALENDAR_RESCHEDULE_ARGUMENTS } from "./calendar-reschedule-tools";
import { chatGptActionTools,chatGptReadableTools } from "./chatgpt-tool-access";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { sanitizeChatGptActionInput,validateChatGptActionInput } from "./chatgpt-write-capabilities";
import { planExecutionAuthorizationSchema } from "./plan-execution";
import { createPlanExecutionAdapters } from "./plan-execution-adapters";
import { recoverCalendarReschedule } from "./calendar-reschedule-recovery";
import { calendarCommandFingerprint,calendarSnapshotFingerprint,type CalendarSnapshot } from "../services/calendar-reschedule";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const snapshot:CalendarSnapshot={occurrenceId:uuid(1),meetingId:uuid(2),ownerType:"vendor",ownerId:4,title:"Meeting",agenda:null,timezone:"UTC",createdById:9,startsAt:"2026-10-07T10:00:00Z",endsAt:"2026-10-07T11:00:00Z",status:"scheduled",participantUserIds:[9,10]};
const step:CalendarExecutionStep={id:"move",adapter:"calendar_reschedule",toolName:"reschedule_work_hub_meeting",operationId:uuid(3),dependsOn:[],arguments:{occurrenceId:uuid(1),expectedFingerprint:calendarSnapshotFingerprint(snapshot),startsAt:"2026-10-08T10:00:00Z",endsAt:"2026-10-08T11:00:00Z",timezone:"UTC"}};
const authorization:CalendarExecutionAuthorization={id:uuid(4),requester:{userId:9,organizationKey:"vendor:4",membershipId:5,sessionVersion:1},grantReference:"private",taskId:uuid(5),taskVersion:1,planId:uuid(6),planVersion:1,planFingerprint:"a".repeat(64),approvedAt:1,expiresAt:90000,maxAttempts:1,steps:[step],notificationOperationId:uuid(7)};
function fixture(){
 const command=calendarRescheduleRequest(step.arguments,step.operationId).body;
 const receipt={operationId:step.operationId,occurrenceId:uuid(1),actorUserId:9,commandFingerprint:calendarCommandFingerprint(command,9),snapshot:{...snapshot,startsAt:command.startsAt,endsAt:command.endsAt},recordedAt:"2026-10-07T09:00:00Z",status:"rescheduled",attendeeAcceptanceVerified:false,externalInvitationsSent:false,physicalAttendanceVerified:false};
 const authorize=vi.fn(async()=>({session:{userId:9,role:"vendor",vendorId:4,activeMembershipId:5,sv:1},scopes:["work_hub:write"],current:{...authorization.requester,grantReference:"private",grantRevoked:false,taskId:uuid(5),taskVersion:1,planId:uuid(6),planVersion:1,planFingerprint:authorization.planFingerprint,availableTools:[step.toolName]}}));
 const request=vi.fn(async(_path:string,_method:"POST",_body:unknown,_session:unknown):Promise<unknown>=>({receipt}));
 return {receipt,authorize,request,run:createPlanCalendarReschedule({authorize,request})};
}
it("uses the exact approved command and recovery endpoint; never interprets saved reschedule as attendance",async()=>{
 const f=fixture();expect((await f.run(authorization,step,false)).state).toBe("completed");expect((await f.run(authorization,step,true)).state).toBe("completed");expect(f.request.mock.calls.map(call=>call[0])).toEqual(["/work-hub/calendar-reschedule/execute","/work-hub/calendar-reschedule/readback"]);expect(f.authorize).toHaveBeenCalledTimes(4);
});
it("refuses altered approved input or absent write consent before effects",async()=>{
 const f=fixture();await expect(f.run(authorization,{...step,arguments:{...step.arguments,confirmed:true}},false)).rejects.toThrow();
 const current=await f.authorize();f.authorize.mockResolvedValue({...current,scopes:[]});await expect(f.run(authorization,step,false)).rejects.toThrow();expect(f.request).not.toHaveBeenCalled();expect(CALENDAR_RESCHEDULE_ARGUMENTS.safeParse({...step.arguments,operationId:uuid(9)}).success).toBe(false);
});
it("only proven missing readback permits not_found; drift and revocation remain unknown or denied",async()=>{
 const f=fixture();f.request.mockResolvedValueOnce({receipt:null});expect(await f.run(authorization,step,true)).toEqual({state:"not_found"});
 for(const receipt of [{...f.receipt,actorUserId:99},{...f.receipt,commandFingerprint:"b".repeat(64)},{...f.receipt,externalInvitationsSent:true}]){f.request.mockResolvedValueOnce({receipt});expect(await f.run(authorization,step,true)).toEqual({state:"unknown"});}
 const current=await f.authorize();f.authorize.mockResolvedValueOnce(current).mockRejectedValueOnce(Error("revoked"));await expect(f.run(authorization,step,false)).rejects.toThrow("revoked");
});
it("discovers only scoped current host actions and routes only trusted server approval",()=>{
 const host={userId:9,role:"vendor",vendorId:4,activeMembershipId:5,sv:1,membershipRole:"admin"};
 expect(chatGptActionTools(host,["work_hub:write"]).some(tool=>tool.name===step.toolName)).toBe(true);
 expect(chatGptReadableTools(host,["work_hub:read"]).some(tool=>tool.name==="query_calendar_reschedule_snapshot")).toBe(true);
 for(const session of [{...host,membershipRole:"member"},{...host,vendorId:null}])expect(chatGptActionTools(session,["work_hub:write"]).some(tool=>tool.name===step.toolName)).toBe(false);
 expect(chatGptActionTools(host,["work_hub:read"]).some(tool=>tool.name===step.toolName)).toBe(false);
 const safe=sanitizeChatGptActionInput(step.toolName,{...step.arguments,operationId:uuid(99),confirmed:true});expect(safe).toEqual(step.arguments);validateChatGptActionInput(step.toolName,safe);
 expect(()=>validateChatGptActionInput(step.toolName,{...safe,operationId:step.operationId})).not.toThrow();
 expect(()=>validateChatGptActionInput(step.toolName,{...safe,operationId:"not-server-uuid"})).toThrow();
 expect(resolveExecutableWorkHubToolRequest(step.toolName,{...safe,operationId:step.operationId},false,host)).toMatchObject({requiresConfirmation:true});
 expect(resolveExecutableWorkHubToolRequest(step.toolName,{...safe,operationId:step.operationId},true,host)).toEqual(calendarRescheduleRequest(step.arguments,step.operationId));
 expect(resolveExecutableWorkHubToolRequest(step.toolName,{...safe,operationId:step.operationId,participantUserIds:[99]},true,host)).toHaveProperty("error");
});
it("registers strict calendar steps and exact recovery with the real canonical adapter contract",async()=>{
 expect(planExecutionAuthorizationSchema.safeParse(authorization).success).toBe(true);
 expect(planExecutionAuthorizationSchema.safeParse({...authorization,steps:[{...step,arguments:{...step.arguments,confirmed:true}}]}).success).toBe(false);
 const f=fixture();const adapters=createPlanExecutionAdapters({read:vi.fn(),savePersonalDraft:vi.fn(),readbackDraft:vi.fn(),rescheduleCalendar:f.run});
 const context={authorization,results:[]};
 expect(await adapters.calendar_reschedule.execute(context,step)).toMatchObject({operationId:step.operationId,sourceReferences:[expect.stringContaining(step.operationId)]});
 expect((await adapters.calendar_reschedule.reconcile(context,step)).state).toBe("completed");
});
it("prepared-action recovery only queries the exact receipt, including missing or denied outcome",async()=>{
 const host={userId:9,role:"vendor",vendorId:4,activeMembershipId:5,sv:1,membershipRole:"admin"},hash="a".repeat(64);
 const operationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",command=calendarRescheduleRequest(step.arguments,operationId).body;
 const receipt={...fixture().receipt,operationId,commandFingerprint:calendarCommandFingerprint(command,9)};
 const request=vi.fn(async():Promise<Record<string,unknown>>=>({receipt}));
 expect(await recoverCalendarReschedule({toolName:step.toolName,tokenHash:hash,arguments:step.arguments},host,["work_hub:write"],request)).toEqual({receipt});
 expect(request.mock.calls[0]).toEqual(["/work-hub/calendar-reschedule/readback","POST",command,host]);
 request.mockResolvedValueOnce({receipt:null});expect(await recoverCalendarReschedule({toolName:step.toolName,tokenHash:hash,arguments:step.arguments},host,["work_hub:write"],request)).toBeNull();
 expect(await recoverCalendarReschedule({toolName:step.toolName,tokenHash:hash,arguments:step.arguments},host,[],request)).toBeNull();expect(request).toHaveBeenCalledTimes(2);
});
it("recovers a dropped response with the same command through readback without another mutation",async()=>{
 const f=fixture(),adapters=createPlanExecutionAdapters({read:vi.fn(),savePersonalDraft:vi.fn(),readbackDraft:vi.fn(),rescheduleCalendar:f.run}),context={authorization,results:[]};
 f.request.mockRejectedValueOnce(Error("response lost"));await expect(adapters.calendar_reschedule.execute(context,step)).rejects.toThrow("response lost");
 expect((await adapters.calendar_reschedule.reconcile(context,step)).state).toBe("completed");
 expect(f.request.mock.calls.map(call=>call[0])).toEqual(["/work-hub/calendar-reschedule/execute","/work-hub/calendar-reschedule/readback"]);
 expect(f.request.mock.calls[0][2]).toEqual(f.request.mock.calls[1][2]);
});
