import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { calendarRescheduleAvailable,calendarRescheduleRequest } from "./calendar-reschedule-tools";
import { calendarCommandFingerprint,calendarRescheduleReceiptSchema } from "../services/calendar-reschedule";
/** Exact receipt only. An uncertain reschedule is never sent again by reconciliation. */
export async function recoverCalendarReschedule(action:{toolName:string;tokenHash:string;arguments:Record<string,unknown>},session:SessionPayload,scopes:string[],request:typeof callNaturalVoiceDomainApi=callNaturalVoiceDomainApi){
 if(action.toolName!=="reschedule_work_hub_meeting"||!/^[a-f0-9]{64}$/.test(action.tokenHash)||!calendarRescheduleAvailable(session,scopes))return null;
 try{
  const hex=action.tokenHash.slice(0,32),operationId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const command=calendarRescheduleRequest(action.arguments,operationId);
  const response=await request("/work-hub/calendar-reschedule/readback","POST",command.body,session);
  if(!response||Array.isArray(response)||typeof response!=="object"||!("receipt" in response))return null;
  const parsed=calendarRescheduleReceiptSchema.safeParse(response.receipt);if(!parsed.success||!session.userId)return null;
  const receipt=parsed.data,owner=session.role==="partner"?`partner:${session.partnerId}`:`vendor:${session.vendorId}`;
  if(receipt.operationId!==operationId||receipt.actorUserId!==session.userId||receipt.commandFingerprint!==calendarCommandFingerprint(command.body,session.userId)||receipt.occurrenceId!==command.body.occurrenceId||`${receipt.snapshot.ownerType}:${receipt.snapshot.ownerId}`!==owner||receipt.snapshot.startsAt!==command.body.startsAt||receipt.snapshot.endsAt!==command.body.endsAt||receipt.snapshot.timezone!==command.body.timezone)return null;
  return response;
 }catch{return null;}
}
