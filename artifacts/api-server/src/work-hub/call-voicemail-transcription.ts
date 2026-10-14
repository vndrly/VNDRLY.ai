import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, workHubVoicemailTable } from "@workspace/db";
import { getObjectStore } from "../lib/objectStore";
import { nativeTranscriptionAvailable, transcribeNativeAudio } from "./native-transcription";
import { authorizeCallTranscript } from "./call-transcript-access";
import { voicemailRetryPlan } from "./voicemail-retry-policy";
import type { SessionPayload } from "../lib/session";
const running = new Set<string>();
export function voicemailJobReady(now = new Date()) {
  return and(isNull(workHubVoicemailTable.deletedAt), isNull(workHubVoicemailTable.transcript), lt(workHubVoicemailTable.transcriptionAttempts,3),
    or(isNull(workHubVoicemailTable.transcriptionNextAttemptAt),lte(workHubVoicemailTable.transcriptionNextAttemptAt,now)),
    or(inArray(workHubVoicemailTable.transcriptionState,["pending","retry","unavailable"]),and(eq(workHubVoicemailTable.transcriptionState,"processing"),lt(workHubVoicemailTable.transcriptionClaimedAt,new Date(now.getTime()-300000)))));
}
/** Persistent compare-and-claim prevents duplicate inference and recovers abandoned jobs. */
export async function transcribeCallVoicemail(actor: SessionPayload & { userId: number }, id: string, internalWorker = false): Promise<void> {
  if(running.has(id))return;
  running.add(id);
  const where=and(eq(workHubVoicemailTable.id,id),isNull(workHubVoicemailTable.deletedAt),isNull(workHubVoicemailTable.transcript));
  let claimToken: string | null=null, attempts=0;
  try {
    const [row]=await db.select().from(workHubVoicemailTable).where(where).limit(1);
    if(!row || row.transcript || ![row.senderUserId,row.recipientUserId].includes(actor.userId))return;
    try { await authorizeCallTranscript(actor,row.callId,"voicemail", db, internalWorker); }
    catch {await db.update(workHubVoicemailTable).set({transcriptionState:"unavailable",transcriptionNextAttemptAt:new Date(Date.now()+900000)}).where(and(where,voicemailJobReady()));return;}
    if(!nativeTranscriptionAvailable()){await db.update(workHubVoicemailTable).set({transcriptionState:"unavailable",transcriptionNextAttemptAt:new Date(Date.now()+900000)}).where(and(where,voicemailJobReady()));return;}
    const token=randomUUID();
    const [claimed]=await db.update(workHubVoicemailTable).set({transcriptionState:"processing",transcriptionAttempts:sql`${workHubVoicemailTable.transcriptionAttempts}+1`,transcriptionClaimToken:token,transcriptionClaimedAt:new Date(),transcriptionNextAttemptAt:null}).where(and(where,voicemailJobReady())).returning();
    if(!claimed)return;
    claimToken=token;attempts=claimed.transcriptionAttempts;
    const owned=and(where,eq(workHubVoicemailTable.transcriptionClaimToken,token));
    const object=await getObjectStore().getObject(row.storageKey);if(!object)throw new Error("private audio missing");
    const text=await transcribeNativeAudio(object.body,row.contentType,undefined,120);
    await authorizeCallTranscript(actor,row.callId,"voicemail", db, internalWorker);
    await db.update(workHubVoicemailTable).set({transcript:text,transcriptionState:text?"ready":"no_speech",transcriptionClaimToken:null,transcriptionClaimedAt:null,transcriptionNextAttemptAt:null}).where(owned);
  } catch {
    if(claimToken){const retry=voicemailRetryPlan(attempts);await db.update(workHubVoicemailTable).set({transcriptionState:retry.state,transcriptionNextAttemptAt:retry.nextAt,transcriptionClaimToken:null,transcriptionClaimedAt:null}).where(and(where,eq(workHubVoicemailTable.transcriptionClaimToken,claimToken)));}
  } finally {running.delete(id);}
}
