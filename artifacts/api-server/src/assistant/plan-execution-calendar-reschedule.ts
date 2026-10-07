import { planExecutionFingerprint, type PlanExecutionAuthorization, type PlanExecutionStep } from "./plan-execution";
import type { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import type { SessionPayload } from "../lib/session";
import { CALENDAR_RESCHEDULE_ARGUMENTS, calendarRescheduleRequest,CALENDAR_SNAPSHOT_INPUT,CALENDAR_SNAPSHOT_OUTPUT } from "./calendar-reschedule-tools";
import { calendarCommandFingerprint, calendarRescheduleReceiptSchema,calendarSnapshotFingerprint } from "../services/calendar-reschedule";
type Authority=Awaited<ReturnType<typeof currentPlanExecutionAuthority>>;
export type CalendarExecutionStep=PlanExecutionStep;
export type CalendarExecutionAuthorization=PlanExecutionAuthorization;
/** Fixed command only; registration requires the separately reviewed core adapter allowlist. */
export function createPlanCalendarReschedule(deps:{authorize:(authorization:CalendarExecutionAuthorization)=>Promise<Authority>;request:(path:string,method:"POST",body:unknown,session:SessionPayload)=>Promise<unknown>}) {
 return async(authorization:CalendarExecutionAuthorization,step:CalendarExecutionStep,readback:boolean)=>{
  const approved=authorization.steps.find(candidate=>candidate.id===step.id);
  if(!approved||step.adapter!=="calendar_reschedule"||step.toolName!=="reschedule_work_hub_meeting"||planExecutionFingerprint(approved)!==planExecutionFingerprint(step))throw Error("Calendar action was not approved");
  const args=CALENDAR_RESCHEDULE_ARGUMENTS.parse(step.arguments);
  const before=await deps.authorize(authorization);
  if(!before.current.availableTools.includes(step.toolName)||!before.scopes.includes("work_hub:write"))throw Error("Calendar action unavailable");
  const command=calendarRescheduleRequest(args,step.operationId);
  const result=await deps.request(readback?"/work-hub/calendar-reschedule/readback":command.path,"POST",command.body,before.session);
  await deps.authorize(authorization);
  if(!result||typeof result!=="object"||Array.isArray(result)||!("receipt" in result))return{state:"unknown" as const};
  const raw=(result as {receipt:unknown}).receipt;
  if(raw===null)return{state:readback?"not_found" as const:"unknown" as const};
  const parsed=calendarRescheduleReceiptSchema.safeParse(raw);if(!parsed.success)return{state:"unknown" as const};const receipt=parsed.data;
  if(receipt.commandFingerprint!==calendarCommandFingerprint(command.body,authorization.requester.userId)||receipt.operationId!==step.operationId||receipt.actorUserId!==authorization.requester.userId||receipt.occurrenceId!==args.occurrenceId||`${receipt.snapshot.ownerType}:${receipt.snapshot.ownerId}`!==authorization.requester.organizationKey||receipt.snapshot.startsAt!==args.startsAt||receipt.snapshot.endsAt!==args.endsAt||receipt.snapshot.timezone!==args.timezone)return{state:"unknown" as const};
  return{state:"completed" as const,result:{operationId:step.operationId,sourceReferences:[`work-hub:meeting:${receipt.occurrenceId}:operation:${receipt.operationId}`],summary:JSON.stringify({occurrenceId:receipt.occurrenceId,startsAt:receipt.snapshot.startsAt,endsAt:receipt.snapshot.endsAt,recordedAt:receipt.recordedAt,status:receipt.status,attendeeAcceptanceVerified:false,externalInvitationsSent:false,physicalAttendanceVerified:false})}};
 };
}
export function createPlanCalendarSnapshotRead(deps:{authorize:typeof currentPlanExecutionAuthority;request:(path:string,method:"GET",body:unknown,session:SessionPayload)=>Promise<unknown>}) {
 return async(authorization:PlanExecutionAuthorization,step:PlanExecutionStep)=>{
  if(step.adapter!=="authorized_read"||step.toolName!=="query_calendar_reschedule_snapshot"||!authorization.steps.some(saved=>planExecutionFingerprint(saved)===planExecutionFingerprint(step)))throw Error("Calendar read was not approved");
  const input=CALENDAR_SNAPSHOT_INPUT.parse(step.arguments),before=await deps.authorize(authorization);
  if(!before.scopes.includes("work_hub:read")||!before.current.availableTools.includes(step.toolName))throw Error("Calendar snapshot unavailable");
  const result=CALENDAR_SNAPSHOT_OUTPUT.parse(await deps.request(`/work-hub/calendar-reschedule/${input.occurrenceId}/snapshot`,"GET",{},before.session));
  await deps.authorize(authorization);
  if(result.snapshot.occurrenceId!==input.occurrenceId||`${result.snapshot.ownerType}:${result.snapshot.ownerId}`!==authorization.requester.organizationKey||result.fingerprint!==calendarSnapshotFingerprint(result.snapshot))throw Error("Calendar source differs from authorized occurrence");
  const {agenda:_agenda,...snapshot}=result.snapshot;
  return{operationId:step.operationId,sourceReferences:[`work-hub:meeting:${input.occurrenceId}:snapshot:${result.fingerprint}`],summary:JSON.stringify({...result,snapshot})};
 };
}
