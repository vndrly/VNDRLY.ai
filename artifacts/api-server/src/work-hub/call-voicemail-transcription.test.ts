import { beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({ row:{id:"mail",callId:"call",senderUserId:1,recipientUserId:2,storageKey:"private",contentType:"audio/wav",transcript:null as string|null}, updates:[] as any[], authorize:vi.fn(), available:vi.fn(), transcribe:vi.fn(), object:vi.fn() }));
vi.mock("@workspace/db",async()=> {
  const {pgTable,text,timestamp,integer,uuid}=await import("drizzle-orm/pg-core");
  return {workHubVoicemailTable:pgTable("test_mail",{id:text("id"),deletedAt:timestamp("deleted_at"),transcript:text("transcript"),transcriptionAttempts:integer("attempts"),transcriptionState:text("state"),transcriptionNextAttemptAt:timestamp("next"),transcriptionClaimedAt:timestamp("claimed"),transcriptionClaimToken:uuid("token")}),db:{select:()=>({from:()=>({where:()=>({limit:async()=>[fixture.row]})})}),update:()=>({set:(value:any)=>{fixture.updates.push(value);return{where:()=>({returning:async()=>[{...fixture.row,transcriptionAttempts:1}],then:(resolve:any)=>resolve(undefined)})};}})}};
});
vi.mock("./call-transcript-access",()=>({authorizeCallTranscript:fixture.authorize}));
vi.mock("./native-transcription",()=>({nativeTranscriptionAvailable:fixture.available,transcribeNativeAudio:fixture.transcribe}));
vi.mock("../lib/objectStore",()=>({getObjectStore:()=>({getObject:fixture.object})}));
import {transcribeCallVoicemail} from "./call-voicemail-transcription";
beforeEach(()=>{fixture.row.transcript=null;fixture.updates=[];fixture.authorize.mockReset().mockResolvedValue({});fixture.available.mockReset().mockReturnValue(true);fixture.transcribe.mockReset().mockResolvedValue("Meet at the north gate.");fixture.object.mockReset().mockResolvedValue({body:Buffer.from("private audio")});});
it("automatically processes locally and saves readable voicemail text",async()=>{
  await transcribeCallVoicemail({userId:1,vendorId:7} as any,"mail");
  expect(fixture.transcribe).toHaveBeenCalledWith(Buffer.from("private audio"),"audio/wav",undefined,120);
  expect(fixture.updates[0]).toMatchObject({transcriptionState:"processing"});
  expect(fixture.updates.at(-1)).toMatchObject({transcript:"Meet at the north gate.",transcriptionState:"ready"});
  expect(fixture.authorize).toHaveBeenCalledTimes(2);
});
it("does not send audio anywhere when the local engine is unavailable",async()=>{
  fixture.available.mockReturnValue(false);
  await transcribeCallVoicemail({userId:1,vendorId:7} as any,"mail");
  expect(fixture.object).not.toHaveBeenCalled();expect(fixture.transcribe).not.toHaveBeenCalled();expect(fixture.updates.at(-1)).toMatchObject({transcriptionState:"unavailable"});
});
it("discards text after policy or membership is revoked",async()=>{
  fixture.authorize.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("revoked"));
  await transcribeCallVoicemail({userId:1,vendorId:7} as any,"mail");
  expect(fixture.updates.at(-1)).toMatchObject({transcriptionState:"retry"});expect(fixture.updates.some(x=>x.transcript)).toBe(false);
});
it("never opens another user's private voicemail",async()=>{
  await transcribeCallVoicemail({userId:9,vendorId:7} as any,"mail");
  expect(fixture.object).not.toHaveBeenCalled();expect(fixture.updates).toEqual([]);
});
