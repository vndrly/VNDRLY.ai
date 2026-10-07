import {expect,it} from "vitest";
import {calendarResponseAvailable,calendarResponseRequest,CALENDAR_RESPONSE_ARGUMENTS} from "./calendar-response-tools";
import {chatGptActionTools,chatGptReadableTools} from "./chatgpt-tool-access";
import {resolveExecutableWorkHubToolRequest} from "./work-hub-tool-runtime";
import {sanitizeChatGptActionInput,validateChatGptActionInput} from "./chatgpt-write-capabilities";
import {recoverCalendarResponse} from "./calendar-response-recovery";
import {calendarResponseCommandFingerprint} from "../services/calendar-response";
const occurrenceId="00000000-0000-4000-8000-000000000001",operationId="00000000-0000-4000-8000-000000000002",input={occurrenceId,expectedFingerprint:"a".repeat(64),response:"accepted"};
it("uses exact own response arguments and server-issued operation only",()=>{expect(calendarResponseRequest(input,operationId)).toEqual({method:"POST",path:"/work-hub/calendar-response/execute",body:{...input,operationId}});for(const args of [{...input,userId:9},{...input,confirmed:true},{...input,recordingConsent:true},{...input,operationId}])expect(CALENDAR_RESPONSE_ARGUMENTS.safeParse(args).success).toBe(false);});
it("requires current company identity and separate read/write consent without host assumptions",()=>{const user={userId:9,role:"field_employee",vendorId:4,activeMembershipId:5,sv:1,membershipRole:"member"};expect(calendarResponseAvailable(user,["work_hub:write"])).toBe(true);expect(calendarResponseAvailable(user,["work_hub:read"],false)).toBe(true);expect(calendarResponseAvailable(user,["work_hub:read"])).toBe(false);expect(calendarResponseAvailable({...user,activeMembershipId:undefined},["work_hub:write"])).toBe(false);});
it("exposes the own response workflow to scoped participants without bypassing trusted approval",()=>{
 const user={userId:9,role:"field_employee",vendorId:4,activeMembershipId:5,sv:1,membershipRole:"member"},name="respond_work_hub_meeting_invitation";
 expect(chatGptActionTools(user,["work_hub:write"]).some(tool=>tool.name===name)).toBe(true);expect(chatGptReadableTools(user,["work_hub:read"]).some(tool=>tool.name==="query_work_hub_meeting_responses")).toBe(true);
 const safe=sanitizeChatGptActionInput(name,{...input,operationId:"model",confirmed:true});expect(safe).toEqual(input);expect(()=>validateChatGptActionInput(name,{...safe,operationId})).not.toThrow();
 expect(resolveExecutableWorkHubToolRequest(name,{...safe,operationId},false,user)).toMatchObject({requiresConfirmation:true});expect(resolveExecutableWorkHubToolRequest(name,{...safe,operationId},true,user)).toEqual(calendarResponseRequest(input,operationId));
 expect(resolveExecutableWorkHubToolRequest(name,{...safe,operationId,userId:10},true,user)).toHaveProperty("error");
});
it("recovers only the exact saved own response without resending",async()=>{
 const user={userId:9,role:"field_employee",vendorId:4,activeMembershipId:5,sv:1},hash="a".repeat(64),stable="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",command=calendarResponseRequest(input,stable).body;
 const receipt={operationId:stable,occurrenceId,actorUserId:9,commandFingerprint:calendarResponseCommandFingerprint(command,9),scheduleFingerprint:input.expectedFingerprint,response:"accepted",recordedAt:"2026-10-07T09:00:00Z",status:"response_recorded",physicalAttendanceVerified:false,recordingConsentGranted:false,externalAttendeeAcceptanceVerified:false};
 const calls:unknown[][]=[];const request=async(...args:Parameters<NonNullable<Parameters<typeof recoverCalendarResponse>[3]>>)=>{calls.push(args);return{receipt};};
 expect(await recoverCalendarResponse({toolName:"respond_work_hub_meeting_invitation",tokenHash:hash,arguments:input},user,["work_hub:write"],request)).toEqual({receipt});expect(calls).toEqual([["/work-hub/calendar-response/readback","POST",command,user]]);
 expect(await recoverCalendarResponse({toolName:"respond_work_hub_meeting_invitation",tokenHash:hash,arguments:input},user,[],request)).toBeNull();expect(calls).toHaveLength(1);
});
