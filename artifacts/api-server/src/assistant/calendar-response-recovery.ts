import type {SessionPayload} from "../lib/session";
import {callNaturalVoiceDomainApi} from "./natural-voice-write-tools";
import {calendarResponseAvailable,calendarResponseRequest} from "./calendar-response-tools";
import {calendarResponseCommandFingerprint,calendarResponseReceiptSchema} from "../services/calendar-response";
/** Recover the exact actor's response receipt only; never sends a response or joins a meeting. */
export async function recoverCalendarResponse(action:{toolName:string;tokenHash:string;arguments:Record<string,unknown>},session:SessionPayload,scopes:string[],request:typeof callNaturalVoiceDomainApi=callNaturalVoiceDomainApi){
 if(action.toolName!=="respond_work_hub_meeting_invitation"||!/^[a-f0-9]{64}$/.test(action.tokenHash)||!calendarResponseAvailable(session,scopes)||!session.userId)return null;
 try{
  const hex=action.tokenHash.slice(0,32),operationId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const command=calendarResponseRequest(action.arguments,operationId);
  const result=await request("/work-hub/calendar-response/readback","POST",command.body,session);
  if(!result||Array.isArray(result)||typeof result!=="object"||!("receipt" in result))return null;
  const parsed=calendarResponseReceiptSchema.safeParse(result.receipt);if(!parsed.success)return null;
  const receipt=parsed.data;
  if(receipt.operationId!==operationId||receipt.actorUserId!==session.userId||receipt.occurrenceId!==command.body.occurrenceId||receipt.scheduleFingerprint!==command.body.expectedFingerprint||receipt.response!==command.body.response||receipt.commandFingerprint!==calendarResponseCommandFingerprint(command.body,session.userId))return null;
  return result;
 }catch{return null;}
}
