import {createHash} from "node:crypto";
import {FleetServiceTemplateSaveSchema,FleetServiceTemplateSchema,FleetServiceTemplatePageSchema,type FleetServiceTemplate} from "@workspace/api-zod";
import type {PoolClient} from "pg";
import type {FleetActor} from "./fleet-ops";
import {FleetError,type FleetState} from "./fleet-repository";
type Transaction=<T>(actor:FleetActor,work:(state:FleetState,client:PoolClient)=>Promise<T>)=>Promise<T>;
type Access=(state:FleetState,actor:FleetActor)=>{roles:readonly string[]}|null;
export async function readFleetServiceTemplate(client:PoolClient,companyId:number,serviceId:number,revision?:number):Promise<FleetServiceTemplate|null>{
 const row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-service-template' AND target_id=$2 AND ($3::int IS NULL OR tool_output->'template'->>'revision'=$3::text) ORDER BY id DESC LIMIT 1",[companyId,String(serviceId),revision??null])).rows[0];return row?FleetServiceTemplateSchema.parse(row.tool_output.template):null;
}
export async function readFleetOfferedTemplates(client:PoolClient,companyId:number){
 const rows=(await client.query("SELECT v.work_type_id AS id,w.name,saved.tool_output->'template' AS template FROM vendor_work_types v JOIN work_types w ON w.id=v.work_type_id LEFT JOIN LATERAL (SELECT a.tool_output FROM assistant_action_audit a WHERE a.vendor_id=v.vendor_id AND a.target_type='fleet-service-template' AND a.target_id=v.work_type_id::text ORDER BY a.id DESC LIMIT 1) saved ON true WHERE v.vendor_id=$1 ORDER BY w.name,w.id",[companyId])).rows;
 return rows.map(row=>({serviceId:row.id,name:row.name,template:row.template?FleetServiceTemplateSchema.parse(row.template):null}));
}
export function createFleetServiceTemplateOperations(transaction:Transaction,access:Access){
 const permitted=(state:FleetState,actor:FleetActor,write=false)=>{const grant=access(state,actor);if(!grant||write&&(actor.readOnly||!grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher")))throw new FleetError("fleet.dispatch_required",403);return grant;};
 return {
  serviceTemplate:(actor:FleetActor,serviceId:number,revision?:number)=>transaction({...actor},async(state,client)=>{permitted(state,actor);const offered=(await client.query("SELECT 1 FROM vendor_work_types WHERE vendor_id=$1 AND work_type_id=$2",[actor.companyId,serviceId])).rows;if(!offered.length)throw new FleetError("fleet.service_not_offered",404);return readFleetServiceTemplate(client,actor.companyId,serviceId,revision);}),
  serviceTemplates:(actor:FleetActor)=>transaction({...actor},async(state,client)=>{const grant=permitted(state,actor);return FleetServiceTemplatePageSchema.parse({services:await readFleetOfferedTemplates(client,actor.companyId),canManage:!actor.readOnly&&grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher")});}),
  saveServiceTemplate:(actor:FleetActor,raw:unknown)=>{const input=FleetServiceTemplateSaveSchema.parse(raw),fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex");return transaction({...actor,operationId:input.operationId},async(state,client)=>{
   permitted(state,actor,true);
   const offered=(await client.query("SELECT work_type_id FROM vendor_work_types WHERE vendor_id=$1 AND work_type_id=$2 FOR SHARE",[actor.companyId,input.template.serviceId])).rows;
   if(!offered.length)throw new FleetError("fleet.service_not_offered",409);
   const prior=(await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-service-template-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,input.operationId])).rows[0];
   if(prior){if(prior.user_id!==actor.userId||prior.tool_output.fingerprint!==fingerprint)throw new FleetError("fleet.operation_conflict",409);return FleetServiceTemplateSchema.parse(prior.tool_output.result);}
   const current=await readFleetServiceTemplate(client,actor.companyId,input.template.serviceId);
   if((current?.revision??0)!==input.expectedRevision||input.template.revision!==input.expectedRevision+1)throw new FleetError("fleet.version_conflict",409);
   const saved=FleetServiceTemplateSchema.parse(input.template),recordedAt=new Date().toISOString();
   for(const [type,id,value] of [["fleet-service-template",String(saved.serviceId),{template:saved,recordedAt,recordedByUserId:actor.userId}],["fleet-service-template-operation",input.operationId,{fingerprint,result:saved}]] as const)await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_service_template','explicit-template-save',$3,$4,$5::jsonb,'completed')",[actor.userId,actor.companyId,type,id,JSON.stringify(value)]);
   return saved;
  });},
 };
}
