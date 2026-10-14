import { and, eq, sql } from "drizzle-orm";
import { db, vendorsTable, workHubCallsTable, workHubMeetingOccurrencesTable, workHubMeetingsTable, workHubVoicemailTable } from "@workspace/db";
import { nativeTranscriptionAvailable } from "./native-transcription";
import { transcribeCallVoicemail, voicemailJobReady } from "./call-voicemail-transcription";
let timer: ReturnType<typeof setInterval> | null=null, busy=false;
export async function pollInternalVoicemailJobs() {
  if(busy || !nativeTranscriptionAvailable())return;
  busy=true;
  try {
    const rows=await db.select({id:workHubVoicemailTable.id,senderUserId:workHubVoicemailTable.senderUserId,vendorId:vendorsTable.id}).from(workHubVoicemailTable)
      .innerJoin(workHubCallsTable,eq(workHubCallsTable.id,workHubVoicemailTable.callId))
      .innerJoin(workHubMeetingOccurrencesTable,eq(workHubMeetingOccurrencesTable.id,workHubCallsTable.occurrenceId))
      .innerJoin(workHubMeetingsTable,eq(workHubMeetingsTable.id,workHubMeetingOccurrencesTable.meetingId))
      .innerJoin(vendorsTable,eq(vendorsTable.id,workHubMeetingsTable.ownerOrgId))
      .where(and(voicemailJobReady(),eq(workHubMeetingsTable.ownerOrgType,"vendor"),sql`${vendorsTable.callTranscriptionPolicy}->>'enabled' = 'true'`)).orderBy(workHubVoicemailTable.createdAt).limit(2);
    await Promise.allSettled(rows.map(row=>transcribeCallVoicemail({userId:row.senderUserId,vendorId:row.vendorId,realm:"production"},row.id,true)));
  } finally {busy=false;}
}
export function startInternalVoicemailWorker() {if(timer)return;timer=setInterval(()=>void pollInternalVoicemailJobs().catch(()=>undefined),5000);timer.unref();void pollInternalVoicemailJobs().catch(()=>undefined);}
export function stopInternalVoicemailWorker() {if(timer)clearInterval(timer);timer=null;}
