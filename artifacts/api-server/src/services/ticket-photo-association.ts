import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { getObjectStore, type ObjectStore } from "../lib/objectStore";
import { canReadTicket } from "../lib/field-ticket-access";
import { AssistantOAuthError } from "../assistant/chatgpt-oauth";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";

export const TicketPhotoInputSchema = z.object({ operationId: z.uuid(), objectPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i) }).strict();
export type TicketPhotoReceipt = { ticketId: number; noteId: number; operationId: string; objectPath: string; sha256: string; size: number; contentType: string; status: "applied"; physicalCaptureVerified: false };
export class TicketPhotoError extends Error { constructor(public code: string, public status = 409) { super(code); } }
const mutable = new Set(["initiated", "draft", "in_progress", "pending_review", "kicked_back"]);
export async function ownedTicketPhoto(userId: number, objectPath: string, store: ObjectStore = getObjectStore()) {
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath)) throw new TicketPhotoError("ticket.photo_invalid",400);
  const source = await store.getObject(objectPath);
  if (!source || source.acl?.owner !== String(userId) || source.acl.visibility !== "private" || source.acl.purpose) throw new TicketPhotoError("ticket.photo_not_owned",403);
  const type = source.contentType.toLowerCase().split(";")[0].trim(), bytes = source.body;
  const signature = type === "image/png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : type === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : type === "image/webp" ? bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" : false;
  if (!signature || !bytes.length || bytes.length > 25*1024*1024 || source.size !== bytes.length) throw new TicketPhotoError("ticket.photo_invalid",400);
  return { sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length,contentType:type };
}
type Authority = (client:PoolClient,session:SessionPayload,ticketId:number)=>Promise<void>;
export async function authorizeTicketPhoto(client:PoolClient,session:SessionPayload,ticketId:number) {
  await client.query("SELECT id FROM users WHERE id=$1 FOR SHARE",[session.userId]);
  if(session.activeMembershipId) await client.query("SELECT id FROM user_org_memberships WHERE id=$1 AND user_id=$2 FOR SHARE",[session.activeMembershipId,session.userId]);
  const database=drizzle(client,{schema});
  try { await validateAssistantSession(session,database); } catch(error) { if(error instanceof AssistantOAuthError) throw new TicketPhotoError("ticket.current_session_required",403); throw error; }
  if(!await canReadTicket(session,ticketId,database)) throw new TicketPhotoError("ticket.no_access",403);
}
/** The note and exact retry receipt commit together. No schema change or physical capture attestation. */
export function createTicketPhotoService(database:Pick<Pool,"connect">=pool,store:()=>ObjectStore=getObjectStore,authorize:Authority=authorizeTicketPhoto) {
  async function execute(session:SessionPayload,ticketId:number,operationId:string,objectPath?:string) {
    if(!session.userId || !Number.isSafeInteger(ticketId) || ticketId<=0 || !z.uuid().safeParse(operationId).success) throw new TicketPhotoError("ticket.photo_invalid",400);
    const client=await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["ticket-photo:"+operationId]);
      const ticket=await client.query("SELECT id,status FROM tickets WHERE id=$1 FOR UPDATE",[ticketId]);
      if(!ticket.rows[0]) throw new TicketPhotoError("ticket.not_found",404);
      await authorize(client,session,ticketId);
      if(!mutable.has(ticket.rows[0].status)) throw new TicketPhotoError("ticket.not_editable");
      const found=await client.query("SELECT user_id,tool_input,tool_output FROM assistant_action_audit WHERE target_type='ticket-photo-association' AND target_id=$1 ORDER BY id LIMIT 1",[operationId]);
      const prior=found.rows[0];
      if(prior && (prior.user_id!==session.userId || prior.tool_output.ticketId!==ticketId || (objectPath && prior.tool_output.objectPath!==objectPath))) throw new TicketPhotoError("ticket.photo_operation_conflict");
      const path=objectPath ?? prior?.tool_output.objectPath;
      if(!path) throw new TicketPhotoError("ticket.photo_association_not_found",404);
      const metadata=await ownedTicketPhoto(session.userId,path,store());
      const fingerprint=createHash("sha256").update(JSON.stringify([session.userId,ticketId,operationId,path,metadata.sha256,metadata.size,metadata.contentType])).digest("hex");
      if(prior) {
        if(prior.tool_input.fingerprint!==fingerprint || prior.tool_output.sha256!==metadata.sha256 || prior.tool_output.size!==metadata.size || prior.tool_output.contentType!==metadata.contentType) throw new TicketPhotoError("ticket.photo_operation_conflict");
        const note=await client.query("SELECT id FROM ticket_note_logs WHERE id=$1 AND ticket_id=$2 AND created_by_id=$3 AND content=$4 AND deleted_at IS NULL",[prior.tool_output.noteId,ticketId,session.userId,"[photo] "+path]);
        if(!note.rows.length) throw new TicketPhotoError("ticket.photo_association_not_found",404);
        await client.query("COMMIT");return prior.tool_output as TicketPhotoReceipt;
      }
      const note=await client.query("INSERT INTO ticket_note_logs(ticket_id,content,created_by_id) VALUES($1,$2,$3) RETURNING id",[ticketId,"[photo] "+path,session.userId]);
      const receipt:TicketPhotoReceipt={ticketId,noteId:note.rows[0].id,operationId,objectPath:path,...metadata,status:"applied",physicalCaptureVerified:false};
      await client.query("INSERT INTO assistant_action_audit(user_id,actor_role,partner_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'api','device_entry','vndrly','associate_ticket_photo','mutation','ticket-photo-association',$5,$6::jsonb,$7::jsonb,'success')",[session.userId,session.role,session.partnerId??null,session.vendorId??null,operationId,JSON.stringify({ticketId,operationId,objectPath:path,fingerprint}),JSON.stringify(receipt)]);
      await client.query("COMMIT");return receipt;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  return {associate:(session:SessionPayload,ticketId:number,input:unknown)=>{const body=TicketPhotoInputSchema.parse(input);return execute(session,ticketId,body.operationId,body.objectPath);},read:(session:SessionPayload,ticketId:number,operationId:string)=>execute(session,ticketId,operationId)};
}
