import { z } from "zod/v4";
import { calendarRescheduleInputSchema,calendarSnapshotSchema } from "../services/calendar-reschedule";
import type { SessionPayload } from "../lib/session";
import { createWorkHubAccess } from "../work-hub/context-access";
const {operationId:_operationId,...argumentShape}=calendarRescheduleInputSchema.shape;
export const CALENDAR_RESCHEDULE_ARGUMENTS = z.object(argumentShape).strict().refine(value=>Date.parse(value.endsAt)>Date.parse(value.startsAt),"Meeting end must follow start");
export const CALENDAR_SNAPSHOT_INPUT=z.object({occurrenceId:z.uuid()}).strict();
export const CALENDAR_SNAPSHOT_OUTPUT=z.object({snapshot:calendarSnapshotSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),executionStarted:z.literal(false)}).strict();
export const CALENDAR_RESCHEDULE_TOOLS = [
  {name:"query_calendar_reschedule_snapshot",description:"Read the current authorized exact saved meeting occurrence, active participants and snapshot fingerprint before reviewing a reschedule. Does not join, record audio or infer invitation acceptance.",inputSchema:z.toJSONSchema(CALENDAR_SNAPSHOT_INPUT),outputSchema:z.toJSONSchema(CALENDAR_SNAPSHOT_OUTPUT),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:"reschedule_work_hub_meeting",description:"Prepare approval to move one exact scheduled Work Hub meeting occurrence using its current snapshot fingerprint, UTC start/end and unchanged saved timezone. Current authenticated host authority is rechecked at execution. Saves the schedule only; prior RSVP is reset pending. In-app notices are best effort, never proof of email delivery or attendee acceptance. No audio or attendance is started.",inputSchema:z.toJSONSchema(CALENDAR_RESCHEDULE_ARGUMENTS),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
] as const;
export function calendarRescheduleAvailable(session:SessionPayload,scopes:readonly string[],write=true){
 const id=session.role==="partner"?session.partnerId:session.vendorId,type=session.role==="partner"?"partner":"vendor";
 if(!id||!session.userId||!session.activeMembershipId||!session.sv||!scopes.includes(write?"work_hub:write":"work_hub:read"))return false;
 try{return createWorkHubAccess({session:{...session,userId:session.userId},owner:{type,id},context:{kind:"organization",id},participant:true}).capabilities.has("meeting.host");}catch{return false;}
}
/** Caller must supply the trusted server operation only after actual action approval. */
export function calendarRescheduleRequest(raw:unknown,operationId?:string) {
 const input=CALENDAR_RESCHEDULE_ARGUMENTS.parse(raw);
 return {method:"POST" as const,path:"/work-hub/calendar-reschedule/execute",body:calendarRescheduleInputSchema.parse({...input,operationId})};
}
