import {z} from "zod/v4";
import type {SessionPayload} from "../lib/session";
import {getObjectStore,renewObjectUploadDescriptor} from "../lib/objectStore";
import {NativeOperationError,NativePolicySchema} from "./native-operations-policy";
import {withLiveNativeTicketAssignment} from "./native-operations";
export const NativeTicketPhotoUploadSchema=z.object({operationId:z.uuid(),contentType:z.enum(["image/jpeg","image/png","image/webp"]),byteSize:z.number().int().positive().max(10*1024*1024),checksumSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function sameNativePhotoUpload(saved:unknown,input:z.infer<typeof NativeTicketPhotoUploadSchema>,ticketId:number,userId:number):saved is {userId:number;ticketId:number;operationId:string;contentType:string;byteSize:number;checksumSha256:string;objectPath:string}{
 const value=saved as Record<string,unknown>|null;
 return !!value&&value.userId===userId&&value.ticketId===ticketId&&value.operationId===input.operationId&&value.contentType===input.contentType&&value.byteSize===input.byteSize&&value.checksumSha256===input.checksumSha256&&typeof value.objectPath==="string"&&/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(value.objectPath);
}
/** Exact reviewed file identity survives offline capture, interrupted uploads and URL expiry. */
export async function prepareNativeTicketPhotoUpload(session:SessionPayload,ticketId:number,raw:unknown){
 const input=NativeTicketPhotoUploadSchema.parse(raw);
 return withLiveNativeTicketAssignment(session,ticketId,async client=>{
  const company=await client.query("SELECT native_operations_policy FROM vendors WHERE id=$1 FOR SHARE",[session.vendorId]);
  if(!company.rows.length||!NativePolicySchema.parse(company.rows[0].native_operations_policy??{}).enabled)throw new NativeOperationError("native.company_opted_out",403);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`native-ticket-photo-upload:${input.operationId}`]);
  const prior=await client.query("SELECT tool_output FROM assistant_action_audit WHERE action_type='native_ticket_photo_upload' AND target_id=$1 ORDER BY id LIMIT 1",[input.operationId]);
  if(prior.rows.length){const saved=prior.rows[0].tool_output;if(!sameNativePhotoUpload(saved,input,ticketId,session.userId!))throw new NativeOperationError("native.upload_content_conflict",409);return {...renewObjectUploadDescriptor(saved.objectPath),ticketId,operationId:input.operationId};}
  const descriptor=getObjectStore().getUploadDescriptor(),saved={...input,userId:session.userId,ticketId,objectPath:descriptor.objectPath};
  await client.query("INSERT INTO assistant_action_audit(user_id,actor_role,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,'ios','device_entry','vndrly','prepare_native_ticket_photo_upload','native_ticket_photo_upload','ticket-photo-upload',$4,$5::jsonb,$6::jsonb,'success')",[session.userId,session.role,session.vendorId,input.operationId,JSON.stringify({ticketId,...input}),JSON.stringify(saved)]);
  return {...descriptor,ticketId,operationId:input.operationId};
 });
}
