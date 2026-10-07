import {createHash,randomUUID} from "node:crypto";
import {z} from "zod/v4";
import {calendarSnapshotSchema,calendarSnapshotFingerprint,type CalendarSnapshot} from "./calendar-reschedule";
export const calendarResponseInputSchema=z.object({operationId:z.uuid(),occurrenceId:z.uuid(),expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/),response:z.enum(["accepted","declined"])}).strict();
export type CalendarResponseInput=z.infer<typeof calendarResponseInputSchema>;
export const calendarResponseReceiptSchema=z.object({operationId:z.uuid(),occurrenceId:z.uuid(),actorUserId:z.number().int().positive(),commandFingerprint:z.string().regex(/^[a-f0-9]{64}$/),scheduleFingerprint:z.string().regex(/^[a-f0-9]{64}$/),response:z.enum(["accepted","declined"]),recordedAt:z.iso.datetime(),status:z.literal("response_recorded"),physicalAttendanceVerified:z.literal(false),recordingConsentGranted:z.literal(false),externalAttendeeAcceptanceVerified:z.literal(false)}).strict();
export const calendarResponseObservationSchema=z.object({snapshot:calendarSnapshotSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),actorUserId:z.number().int().positive(),canManage:z.boolean(),responses:z.array(z.object({userId:z.number().int().positive(),response:z.enum(["unknown","pending","accepted","declined"]),recordedResponse:z.enum(["pending","accepted","declined"]),scheduleResponseVerified:z.boolean(),recordedAt:z.iso.datetime().nullable()}).strict()).max(100),source:z.literal("saved_work_hub_participant_response"),physicalAttendanceVerified:z.literal(false),externalAttendeeAcceptanceVerified:z.literal(false)}).strict();
type Receipt=z.infer<typeof calendarResponseReceiptSchema>;
type Locked={snapshot:CalendarSnapshot;responses:{userId:number;response:"pending"|"accepted"|"declined"}[];responseReceipts:unknown[];prior:unknown;authorize():Promise<{canManage:boolean}>;save(receipt:Receipt):Promise<void>};
export function calendarResponseCommandFingerprint(input:CalendarResponseInput,actorUserId:number){return createHash("sha256").update(JSON.stringify({input:calendarResponseInputSchema.parse(input),actorUserId})).digest("hex");}
export function createCalendarResponse(deps:{now():Date;transaction<T>(input:CalendarResponseInput,actorUserId:number,run:(locked:Locked)=>Promise<T>):Promise<T>}){
 async function perform(raw:unknown,actorUserId:number,readback:boolean){
  const input=calendarResponseInputSchema.parse(raw),fingerprint=calendarResponseCommandFingerprint(input,actorUserId);
  return deps.transaction(input,actorUserId,async locked=>{
   await locked.authorize();
   if(locked.prior!==null){const prior=calendarResponseReceiptSchema.parse(locked.prior);if(prior.operationId!==input.operationId||prior.actorUserId!==actorUserId||prior.occurrenceId!==input.occurrenceId||prior.commandFingerprint!==fingerprint)throw Error("calendar.operation_conflict");return{receipt:prior,replayed:true};}
   if(readback)return{receipt:null,replayed:false};
   if(locked.snapshot.status!=="scheduled")throw Error("calendar.terminal_occurrence");
   const current=calendarSnapshotFingerprint(locked.snapshot);if(current!==input.expectedFingerprint)throw Error("calendar.snapshot_conflict");
   const receipt=calendarResponseReceiptSchema.parse({operationId:input.operationId,occurrenceId:input.occurrenceId,actorUserId,commandFingerprint:fingerprint,scheduleFingerprint:current,response:input.response,recordedAt:deps.now().toISOString(),status:"response_recorded",physicalAttendanceVerified:false,recordingConsentGranted:false,externalAttendeeAcceptanceVerified:false});
   await locked.save(receipt);return{receipt,replayed:false};
  });
 }
 return{execute:(raw:unknown,actorUserId:number)=>perform(raw,actorUserId,false),readback:(raw:unknown,actorUserId:number)=>perform(raw,actorUserId,true),async inspect(rawId:unknown,actorUserId:number){
  const occurrenceId=z.uuid().parse(rawId);return deps.transaction({operationId:randomUUID(),occurrenceId,expectedFingerprint:"0".repeat(64),response:"accepted"},actorUserId,async locked=>{
   const {canManage}=await locked.authorize();
   const snapshot=calendarSnapshotSchema.parse(locked.snapshot);
   // Ordinary participants see their own recorded response only, not other recipients' decisions.
   const fingerprint=calendarSnapshotFingerprint(snapshot),receipts=locked.responseReceipts.map(value=>calendarResponseReceiptSchema.safeParse(value)).filter(parsed=>parsed.success).map(parsed=>parsed.data);
   const responses=(canManage?locked.responses:locked.responses.filter(value=>value.userId===actorUserId)).map(value=>{
    const receipt=receipts.find(receipt=>receipt.actorUserId===value.userId&&receipt.occurrenceId===occurrenceId&&receipt.scheduleFingerprint===fingerprint&&receipt.response===value.response&&receipt.commandFingerprint===calendarResponseCommandFingerprint({operationId:receipt.operationId,occurrenceId,expectedFingerprint:fingerprint,response:receipt.response},value.userId));
    return{userId:value.userId,recordedResponse:value.response,response:receipt?receipt.response:value.response==="pending"?"pending" as const:"unknown" as const,scheduleResponseVerified:!!receipt,recordedAt:receipt?.recordedAt??null};
   });
   return calendarResponseObservationSchema.parse({snapshot,fingerprint,actorUserId,canManage,responses,source:"saved_work_hub_participant_response",physicalAttendanceVerified:false,externalAttendeeAcceptanceVerified:false});
  });
 }};
}
