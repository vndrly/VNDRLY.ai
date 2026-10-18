import {createHash,randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {FleetPolicyChangeSchema,FleetPolicyConfigurationSchema,FleetPolicyImpactSchema,FleetPolicyActivationSchema,FleetCompliancePolicySchema,resolveFleetCompliancePolicy,type FleetRun,type FleetActionPolicySnapshot} from "@workspace/api-zod";
import type {PoolClient} from "pg";
import {FleetError} from "./fleet-repository";
type Actor={userId?:number;sv?:number;role?:string;partnerId?:number|null;activeMembershipId?:number|null;publicDemo?:boolean;readOnly?:boolean};
type Binding={partnerId:number;vendorId:number};

async function authorize(client:PoolClient,actor:Actor,binding:Binding){
 if(actor.publicDemo||actor.readOnly||actor.role!=="partner"||actor.partnerId!==binding.partnerId)throw new FleetError("fleet.partner_approval_required",403);
 const current=await client.query("SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.user_id=$2 AND m.org_type='partner' AND m.partner_id=$3 AND m.role='admin' AND u.session_version=$4 AND u.suspended_at IS NULL FOR SHARE OF m,u",[actor.activeMembershipId,actor.userId,binding.partnerId,actor.sv]);
 if(!current.rows.length)throw new FleetError("fleet.current_session_required",403);
 const relationship=(await client.query("SELECT id,fleet_compliance_policies FROM partner_vendor_relationships WHERE partner_id=$1 AND vendor_id=$2 FOR UPDATE",[binding.partnerId,binding.vendorId])).rows[0];
 if(!relationship)throw new FleetError("fleet.partner_approval_required",403);
 return {id:relationship.id,configuration:FleetPolicyConfigurationSchema.parse(relationship.fleet_compliance_policies??{version:0,policies:[]})};
}
async function transaction<T>(work:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
async function validateProposal(client:PoolClient,binding:Binding,input:ReturnType<typeof FleetPolicyChangeSchema.parse>,configuration:ReturnType<typeof FleetPolicyConfigurationSchema.parse>){
 const proposal=input.proposal;
 if(configuration.version!==input.expectedVersion)throw new FleetError("fleet.policy_version_conflict",409);
 if(proposal.scope.partnerId!==binding.partnerId||proposal.scope.contractId!==null)throw new FleetError("fleet.policy_scope_unverified",403);
 if(proposal.policyId&&!configuration.policies.some(policy=>policy.id===proposal.policyId))throw new FleetError("fleet.policy_version_conflict",409);
 if(Date.parse(proposal.effectiveFrom)<=Date.now())throw new FleetError("fleet.policy_future_date_required",409);
 if(proposal.scope.siteId&&!(await client.query("SELECT id FROM site_locations WHERE id=$1 AND partner_id=$2 AND COALESCE(hidden,false)=false FOR SHARE",[proposal.scope.siteId,binding.partnerId])).rows.length)throw new FleetError("fleet.policy_scope_unverified",403);
 if(proposal.scope.workTypeId&&!(await client.query("SELECT id FROM partner_vendor_work_type_approvals WHERE partner_id=$1 AND vendor_id=$2 AND work_type_id=$3 FOR SHARE",[binding.partnerId,binding.vendorId,proposal.scope.workTypeId])).rows.length)throw new FleetError("fleet.policy_scope_unverified",403);
 if(configuration.policies.length>=1000)throw new FleetError("fleet.policy_history_capacity",409);
}
export function readFleetPolicy(actor:Actor,binding:Binding){return transaction(async client=>(await authorize(client,actor,binding)).configuration);}
export function previewFleetPolicy(actor:Actor,binding:Binding,raw:unknown){const input=FleetPolicyChangeSchema.parse(raw);return transaction(async client=>{
 const {configuration}=await authorize(client,actor,binding);await validateProposal(client,binding,input,configuration);
 const counts=(await client.query(`WITH latest AS (
 SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY target_id,id DESC
 ) SELECT count(*)::int AS activities,count(*) FILTER(WHERE (CASE WHEN latest.tool_output ? 'eventHistory' THEN
 (SELECT a.tool_output->'event'->'details'->'fleetCompliance'->>'status' FROM assistant_action_audit a WHERE a.vendor_id=$1 AND a.target_type='fleet-run-event' AND a.tool_output->>'runId'=latest.tool_output->>'id' AND (a.tool_output->>'sequence')::bigint<=(latest.tool_output->'eventHistory'->>'totalEvents')::bigint AND a.tool_output->'event'->'details'->'fleetCompliance'->>'status' IS NOT NULL ORDER BY (a.tool_output->>'sequence')::bigint DESC LIMIT 1)
 ELSE (SELECT e.value->'details'->'fleetCompliance'->>'status' FROM jsonb_array_elements(COALESCE(latest.tool_output->'events','[]'::jsonb)) WITH ORDINALITY e WHERE e.value->'details'->'fleetCompliance'->>'status' IS NOT NULL ORDER BY e.ordinality DESC LIMIT 1) END)='red')::int AS red
 FROM latest JOIN tickets t ON t.id=(latest.tool_output->>'linkedTicketId')::int JOIN site_locations s ON s.id=t.site_location_id
 WHERE t.vendor_id=$1 AND s.partner_id=$2 AND ($3::int IS NULL OR t.site_location_id=$3) AND ($4::int IS NULL OR COALESCE((latest.tool_output->'billingV2'->>'serviceId')::int,t.work_type_id)=$4)
 AND latest.tool_output->>'status' NOT IN ('completed','cancelled')`,[binding.vendorId,binding.partnerId,input.proposal.scope.siteId,input.proposal.scope.workTypeId])).rows[0];
 return FleetPolicyImpactSchema.parse({version:configuration.version,mode:input.proposal.mode,existingActivities:counts.activities,currentlyRed:counts.red,evaluatedAt:new Date().toISOString(),basis:"recorded_checkpoints_only",existingWorkTreatment:input.proposal.existingWorkTreatment});
});}
export function activateFleetPolicy(actor:Actor,binding:Binding,raw:unknown){const input=FleetPolicyChangeSchema.parse(raw);return transaction(async client=>{
 const {id,configuration}=await authorize(client,actor,binding),fingerprint=createHash("sha256").update(JSON.stringify({binding,input})).digest("hex"),target=`policy-operation:${input.operationId}`;
 const prior=(await client.query("SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND partner_id=$2 AND target_type='fleet-compliance-policy' AND target_id=$3 ORDER BY id DESC LIMIT 1",[binding.vendorId,binding.partnerId,target])).rows[0];
 if(prior){if(prior.user_id!==actor.userId||prior.tool_output.fingerprint!==fingerprint)throw new FleetError("fleet.operation_conflict",409);return FleetPolicyActivationSchema.parse(prior.tool_output.receipt);}
 await validateProposal(client,binding,input,configuration);
 const {policyId,...proposal}=input.proposal,policy=FleetCompliancePolicySchema.parse({...proposal,effectiveFrom:new Date(proposal.effectiveFrom).toISOString(),effectiveUntil:proposal.effectiveUntil?new Date(proposal.effectiveUntil).toISOString():null,id:policyId??randomUUID(),version:policyId?Math.max(...configuration.policies.filter(value=>value.id===policyId).map(value=>value.version))+1:1,activatedByUserId:actor.userId});
 // A site-wide and a service-wide rule can overlap at the same run even
 // when neither proposed scope names both dimensions. Reject the tie now.
 const dimensions=["siteId","contractId","workTypeId"] as const,specificity=(value:typeof policy)=>dimensions.filter(key=>value.scope[key]!==null).length;
 if(configuration.policies.some(previous=>previous.id!==policy.id&&previous.effectiveFrom===policy.effectiveFrom&&previous.version===policy.version&&specificity(previous)===specificity(policy)&&dimensions.every(key=>previous.scope[key]===null||policy.scope[key]===null||previous.scope[key]===policy.scope[key])))throw new FleetError("fleet.policy_ambiguous",409);
 const receipt=FleetPolicyActivationSchema.parse({version:configuration.version+1,operationId:input.operationId,policy});
 await client.query("UPDATE partner_vendor_relationships SET fleet_compliance_policies=$2::jsonb WHERE id=$1",[id,JSON.stringify({version:receipt.version,policies:[...configuration.policies,policy]})]);
 await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,partner_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,'fleet','typed','canonical','fleet_policy','explicit-future-activation','fleet-compliance-policy',$4,$5::jsonb,'completed')",[actor.userId,binding.vendorId,binding.partnerId,target,JSON.stringify({fingerprint,receipt})]);return receipt;
});}

const checkpointFor:Record<string,string[]>={create:["detail","reservation"],dispatch:["dispatch"],acknowledge:["accept"],start:["start"],resume:["start"],reassign:["detail","reservation","replace"],replacement_accept:["detail","reservation","replace"],submit_closeout:["close"],office_submit:["office_submit"],edit:["route_change","reservation"]};
/** Canonical checkpoint only. Client capture dates never waive a future rule;
 * actual already-created work may preserve its server-recorded capture policy. */
export async function applyFleetPartnerPolicy(client:PoolClient,run:FleetRun,action:string,snapshot:FleetActionPolicySnapshot){
 const checkpoints=checkpointFor[action];if(!checkpoints||!run.linkedTicketId)return snapshot;
 const binding=(await client.query("SELECT s.partner_id,t.site_location_id,t.work_type_id,r.fleet_compliance_policies FROM tickets t JOIN site_locations s ON s.id=t.site_location_id JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id AND r.vendor_id=t.vendor_id WHERE t.id=$1 AND t.vendor_id=$2 FOR SHARE OF t,s,r",[run.linkedTicketId,run.companyId])).rows[0];if(!binding)throw new FleetError("fleet.policy_scope_unverified",403);
 const configuration=FleetPolicyConfigurationSchema.parse(binding.fleet_compliance_policies??{version:0,policies:[]});
 const query={partnerId:binding.partner_id,siteId:binding.site_location_id,contractId:null,workTypeId:run.billingV2?.serviceId??binding.work_type_id,policies:configuration.policies};
 let policy=resolveFleetCompliancePolicy({...query,at:snapshot.evaluatedAt});
 const created=run.events.find(event=>event.type==="created"),createdAt=created?.recordedAt;
 if(createdAt&&policy.existingWorkTreatment==="preserve_capture_policy"&&Date.parse(createdAt)<Date.parse(policy.effectiveFrom))policy=resolveFleetCompliancePolicy({...query,at:createdAt});
 const applies=checkpoints.some(value=>policy.checkpoints.includes(value as typeof policy.checkpoints[number]));
 if(applies&&policy.mode==="enforced"&&snapshot.status==="red")throw new FleetError("fleet.partner_compliance_required",409);
 return {...snapshot,mode:applies?policy.mode:"warn_only" as const,policies:[policy]};
}
