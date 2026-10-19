import {createHash} from "node:crypto";
import {z} from "zod/v4";
import type {PoolClient} from "pg";
import {FleetWorkCommandSchema,serializeFleetWorkCommand,type FleetWorkCommand} from "@workspace/api-zod";
import {getObjectStore,type ObjectStore} from "../lib/objectStore";
import {FleetError} from "./fleet-repository";

const recordSchema=z.object({version:z.literal(2),operationId:z.uuid(),companyId:z.number().int().positive(),owner:z.string(),objectPath:z.string(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),requestFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),byteSize:z.number().int().positive(),retainedAt:z.iso.datetime().optional()}).strict();
/** Full originals are private documents, never ordinary audit/tool output. */
export async function retainFleetWorkOriginal(client:PoolClient,command:FleetWorkCommand,store:ObjectStore=getObjectStore(),requestFingerprint?:string){
 const body=Buffer.from(serializeFleetWorkCommand(command)),fingerprint=createHash("sha256").update(body).digest("hex"),companyId=command.scope.owner.id;
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`fleet-work-original:${companyId}:${command.operationId}`]);
 const prior=(await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND target_id=$2 ORDER BY id DESC LIMIT 1",[companyId,command.operationId])).rows[0];
 const record=prior?recordSchema.parse(prior.tool_output):recordSchema.parse({requestFingerprint,retainedAt:new Date().toISOString(),version:2,operationId:command.operationId,companyId,owner:`fleet-work-original:${companyId}:${command.scope.userId}:${command.scope.provisioningId}`,objectPath:`/objects/fleet-work-originals/${companyId}/${command.scope.provisioningId}/${command.operationId}-${fingerprint}.json`,fingerprint,byteSize:body.length});
 if(prior&&(prior.user_id!==command.scope.userId||record.companyId!==companyId||record.operationId!==command.operationId||record.fingerprint!==fingerprint||record.owner!==`fleet-work-original:${companyId}:${command.scope.userId}:${command.scope.provisioningId}`||(requestFingerprint!==undefined&&record.requestFingerprint!==requestFingerprint)))throw new FleetError("fleet.original_identity_conflict",409);
 const existing=await store.getObject(record.objectPath);
 if(existing&&(existing.acl?.owner!==record.owner||existing.acl.visibility!=="private"||existing.acl.purpose!=="fleet-work-private"||!existing.body.equals(body)))throw new FleetError("fleet.original_identity_conflict",409);
 if(!existing)await store.putObject(record.objectPath,"application/json",body,{owner:record.owner,visibility:"private",purpose:"fleet-work-private"});
 const saved=await store.getObject(record.objectPath);
 if(!saved||saved.acl?.owner!==record.owner||saved.acl.visibility!=="private"||saved.acl.purpose!=="fleet-work-private"||!saved.body.equals(body))throw new FleetError("fleet.original_storage_unavailable",503);
 if(!prior)await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work','original-retained','fleet-work-original',$3,$4::jsonb,'completed')",[command.scope.userId,companyId,command.operationId,JSON.stringify(record)]);
 return record;
}
/** Internal recovery only. Callers authorize the case before returning a safe
 * summary; this function never supplies a public file URL. */
export async function readFleetWorkOriginal(client:PoolClient,companyId:number,operationId:string,store:ObjectStore=getObjectStore()){
 const row=(await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND target_id=$2 ORDER BY id DESC LIMIT 1",[companyId,z.uuid().parse(operationId)])).rows[0];
 if(!row)throw new FleetError("fleet.original_recovery_required",409);
 const record=recordSchema.parse(row.tool_output),object=await store.getObject(record.objectPath);
 if(record.companyId!==companyId||record.operationId!==operationId||!object||object.size!==record.byteSize||object.acl?.owner!==record.owner||object.acl.visibility!=="private"||object.acl.purpose!=="fleet-work-private"||createHash("sha256").update(object.body).digest("hex")!==record.fingerprint)throw new FleetError("fleet.original_storage_unavailable",503);
 const command=FleetWorkCommandSchema.parse(JSON.parse(object.body.toString("utf8")));
 if(command.scope.owner.type!=="vendor"||command.scope.owner.id!==companyId||command.scope.userId!==row.user_id||command.operationId!==operationId||createHash("sha256").update(serializeFleetWorkCommand(command)).digest("hex")!==record.fingerprint)throw new FleetError("fleet.original_storage_unavailable",503);
 return {command,fingerprint:record.fingerprint,requestFingerprint:record.requestFingerprint};
}
