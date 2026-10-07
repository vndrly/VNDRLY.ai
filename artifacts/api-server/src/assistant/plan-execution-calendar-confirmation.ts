import type { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import type { SessionPayload } from "../lib/session";
import { planExecutionFingerprint,planExecutionResultSchema,type PlanExecutionAuthorization,type PlanExecutionStep,type PlanExecutionObservation } from "./plan-execution";
import { calendarResponseAvailable } from "./calendar-response-tools";
import { calendarResponseObservationSchema } from "../services/calendar-response";
import { calendarSnapshotFingerprint } from "../services/calendar-reschedule";
import { CALENDAR_CONFIRMATION_ARGUMENTS } from "./plan-execution-calendar-confirmation-policy";
/** Read-only polling of the exact reviewed host schedule. No response, invitation or delivery is manufactured. */
export function createPlanCalendarConfirmation(deps:{authorize:typeof currentPlanExecutionAuthority;request:(path:string,method:"GET",body:unknown,session:SessionPayload)=>Promise<unknown>;now?:()=>number}){
 return async(authorization:PlanExecutionAuthorization,step:PlanExecutionStep,attempt:number):Promise<PlanExecutionObservation>=>{
  if(step.adapter!=="calendar_confirmation"||step.toolName!=="query_work_hub_meeting_responses"||!authorization.steps.some(saved=>planExecutionFingerprint(saved)===planExecutionFingerprint(step)))throw Error("Confirmation intent was not approved");
  const input=CALENDAR_CONFIRMATION_ARGUMENTS.parse(step.arguments),deadline=Date.parse(input.deadlineAt);
  if(deadline<=authorization.approvedAt||deadline>authorization.expiresAt||!Number.isInteger(attempt)||attempt<1||attempt>authorization.maxAttempts)throw Error("Invalid reviewed confirmation bounds");
  function available(current:Awaited<ReturnType<typeof deps.authorize>>){if(!calendarResponseAvailable(current.session,current.scopes,false)||!current.current.availableTools.includes(step.toolName))throw Error("Confirmation authority unavailable");}
  const before=await deps.authorize(authorization);available(before);
  const result=calendarResponseObservationSchema.parse(await deps.request(`/work-hub/calendar-response/${input.occurrenceId}/snapshot`,"GET",{},before.session));available(await deps.authorize(authorization));
  if(!result.canManage||result.actorUserId!==authorization.requester.userId||result.snapshot.createdById!==authorization.requester.userId||result.snapshot.status!=="scheduled"||result.snapshot.occurrenceId!==input.occurrenceId||`${result.snapshot.ownerType}:${result.snapshot.ownerId}`!==authorization.requester.organizationKey||result.fingerprint!==input.expectedFingerprint||calendarSnapshotFingerprint(result.snapshot)!==input.expectedFingerprint)throw Error("Reviewed host schedule changed");
  const ids=result.snapshot.participantUserIds;
  if(new Set(ids).size!==ids.length||result.responses.length!==ids.length||new Set(result.responses.map(r=>r.userId)).size!==ids.length||result.responses.some(r=>!ids.includes(r.userId)))throw Error("Current participant set changed");
  const counts={accepted:0,declined:0,pending:0,unknown:0};
  for(const response of result.responses){if(response.scheduleResponseVerified&&response.recordedAt&&response.response===response.recordedResponse&&(response.response==="accepted"||response.response==="declined"))counts[response.response]++;else if(response.response==="pending")counts.pending++;else counts.unknown++;}
  const now=(deps.now??Date.now)();
  const outcome=counts.declined?"declined":counts.accepted===ids.length?"accepted":now>=deadline?"deadline_reached":attempt>=authorization.maxAttempts?"attempts_exhausted":null;
  if(!outcome)return {state:"waiting",retryAt:Math.min(now+60_000,deadline)};
  return {state:"completed",result:planExecutionResultSchema.parse({operationId:step.operationId,sourceReferences:[`work-hub:meeting:${input.occurrenceId}:snapshot:${input.expectedFingerprint}`],summary:JSON.stringify({occurrenceId:input.occurrenceId,scheduleFingerprint:input.expectedFingerprint,outcome,savedReplyCounts:counts,observedAt:new Date(now).toISOString(),deadlineAt:input.deadlineAt,attempt,maxAttempts:authorization.maxAttempts,deliveryVerified:false,physicalAttendanceVerified:false,externalAttendeeAcceptanceVerified:false,interpretation:"Saved same-schedule Work Hub responses only. Deadline or bounded attempts may stop while responses remain pending or unknown. Acceptance is not attendance or delivery proof."})})};
 };
}
