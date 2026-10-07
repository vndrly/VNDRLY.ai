import type {currentPlanExecutionAuthority} from "./plan-execution-authorization";
import type {SessionPayload} from "../lib/session";
import {planExecutionFingerprint,planExecutionResultSchema,type PlanExecutionAuthorization,type PlanExecutionStep} from "./plan-execution";
import {CALENDAR_RESPONSE_READ_INPUT,calendarResponseAvailable} from "./calendar-response-tools";
import {calendarResponseObservationSchema} from "../services/calendar-response";
import {calendarSnapshotFingerprint} from "../services/calendar-reschedule";
/** Read saved responses only. Never records acceptance, joins, messages or grants consent. */
export function createPlanCalendarResponsesRead(deps:{authorize:typeof currentPlanExecutionAuthority;request:(path:string,method:"GET",body:unknown,session:SessionPayload)=>Promise<unknown>}){
 return async(authorization:PlanExecutionAuthorization,step:PlanExecutionStep)=>{
  if(step.adapter!=="authorized_read"||step.toolName!=="query_work_hub_meeting_responses"||!authorization.steps.some(saved=>planExecutionFingerprint(saved)===planExecutionFingerprint(step)))throw Error("Calendar responses read was not approved");
  const input=CALENDAR_RESPONSE_READ_INPUT.parse(step.arguments),before=await deps.authorize(authorization);
  if(!calendarResponseAvailable(before.session,before.scopes,false)||!before.current.availableTools.includes(step.toolName))throw Error("Calendar responses unavailable");
  const result=calendarResponseObservationSchema.parse(await deps.request(`/work-hub/calendar-response/${input.occurrenceId}/snapshot`,"GET",{},before.session));await deps.authorize(authorization);
  if(result.actorUserId!==authorization.requester.userId||result.snapshot.occurrenceId!==input.occurrenceId||`${result.snapshot.ownerType}:${result.snapshot.ownerId}`!==authorization.requester.organizationKey||result.fingerprint!==calendarSnapshotFingerprint(result.snapshot)||!result.canManage&&result.responses.some(response=>response.userId!==authorization.requester.userId))throw Error("Calendar responses outside approved scope");
  const selected=result.responses.slice(0,20);
  return planExecutionResultSchema.parse({operationId:step.operationId,sourceReferences:[`work-hub:meeting:${input.occurrenceId}:snapshot:${result.fingerprint}`],summary:JSON.stringify({occurrenceId:input.occurrenceId,title:result.snapshot.title,startsAt:result.snapshot.startsAt,endsAt:result.snapshot.endsAt,timezone:result.snapshot.timezone,fingerprint:result.fingerprint,responses:selected,totalVisibleResponses:result.responses.length,responsesTruncated:result.responses.length>selected.length,savedReplyCounts:{accepted:result.responses.filter(value=>value.response==="accepted"&&value.scheduleResponseVerified).length,declined:result.responses.filter(value=>value.response==="declined"&&value.scheduleResponseVerified).length,pending:result.responses.filter(value=>value.response==="pending").length,unknown:result.responses.filter(value=>value.response==="unknown").length},externalAttendeeAcceptanceVerified:false,physicalAttendanceVerified:false,interpretation:"Current saved Work Hub responses only. Acceptance does not prove attendance, recording consent or external attendee confirmation."})});
 };
}
