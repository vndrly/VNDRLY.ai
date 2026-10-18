import {readFleetOfferedTemplates} from "./fleet-service-template";
import {z} from "zod/v4";
import {FleetWorkPreparationSchema,FleetTicketBillingV2Schema,FleetTicketPlanSchema,FleetWorkBillingOptionsSchema,FleetPricingBasisSchema} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {createFleetWorkCanonicalService} from "./fleet-work-canonical";
import {readFleetAuthoritySites,resolveFleetCommercialAuthority} from "./fleet-commercial-authority";
import {isFleetBillingV2TicketOpen} from "./fleet-billing-v2";
import {FleetError} from "./fleet-repository";
const inputSchema=z.object({detailId:z.uuid(),billingSiteId:z.number().int().positive(),ticketId:z.number().int().positive().nullable()}).strict();
export async function readFleetWorkBillingChoices(context:FleetWorkExecutionContext,raw:unknown){
 const input=z.object({fleetId:z.uuid(),siteId:z.number().int().positive(),afeNumber:z.string().trim().max(200),workDate:z.iso.date()}).strict().parse(raw),{actor,state,client}=context,grant=state.grants.find(row=>row.userId===actor.userId);
 const own=!!grant?.roles.includes("driver")&&!grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher");
 if(!state.enabled||!grant||(!own&&!grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher"))||!grant.fleetIds.includes(input.fleetId)||(!own&&!grant.siteIds.includes(input.siteId))||!state.fleets.some(group=>group.id===input.fleetId&&group.siteIds.includes(input.siteId)))throw new FleetError("fleet.dispatch_required",403);
 const site=(await readFleetAuthoritySites(client,actor.companyId,{siteIds:[input.siteId],activeOnly:true}))[0];if(!site)throw new FleetError("fleet.ticket_site_forbidden",403);
 let existing:Record<string,unknown>;
 if(own){const rows=(await client.query("SELECT id,status,fleet_plan FROM tickets WHERE vendor_id=$1 AND site_location_id=$2 AND fleet_plan->>'afeNumber'=$3 AND fleet_plan->>'workDate'=$4 AND fleet_plan->>'billingVersion'='2' ORDER BY id DESC LIMIT 201",[actor.companyId,input.siteId,input.afeNumber,input.workDate])).rows;if(rows.length>200)throw new FleetError("fleet.ticket_limit_reached",409);const tickets=rows.flatMap(row=>{const plan=FleetTicketBillingV2Schema.parse(row.fleet_plan);return isFleetBillingV2TicketOpen(row.status)&&site.fleet_ticket_policy?.mode!=="singles"&&plan.batchingAllowed&&!plan.finalizedAt&&!plan.finalizationOperationId&&plan.vendorId===actor.companyId&&plan.partnerId===site.partner_id?[{id:row.id,ticketNumber:row.id,siteId:input.siteId,afeNumber:plan.afeNumber,workDate:plan.workDate,planVersion:plan.revision}]:[];});const metadata=(await client.query("SELECT afe FROM site_locations WHERE id=$1",[input.siteId])).rows[0];existing={tickets,afeRequired:!!metadata?.afe?.trim(),siteAfe:metadata?.afe??""};}
 else existing=await createFleetWorkCanonicalService(context).billingOptions({...actor},input);
 const rows=(await client.query("SELECT DISTINCT w.id,w.name,pw.approved_unit,COALESCE(NULLIF(btrim(sw.afe),''),btrim(s.afe),'') AS afe_number FROM site_work_assignments sw JOIN work_types w ON w.id=sw.work_type_id JOIN site_locations s ON s.id=sw.site_location_id LEFT JOIN partner_vendor_work_type_approvals pw ON pw.vendor_id=sw.vendor_id AND pw.partner_id=s.partner_id AND pw.work_type_id=w.id WHERE sw.vendor_id=$1 AND sw.site_location_id=$2 ORDER BY w.name,w.id",[actor.companyId,input.siteId])).rows,workTypes=[];
 for(const row of rows){const authority=await resolveFleetCommercialAuthority(client,actor,{partnerId:site.partner_id,billingSiteId:input.siteId,workTypeId:row.id,workDate:input.workDate,purpose:"capture",policyAt:new Date().toISOString()});if(!authority.allowed)continue;const basis=FleetPricingBasisSchema.safeParse(row.approved_unit);workTypes.push({id:row.id,name:row.name,unit:basis.success?basis.data:null,afeNumber:row.afe_number});}
 return FleetWorkBillingOptionsSchema.parse({...existing,workTypes,referenceFreshness:"current",downloadedAt:new Date().toISOString()});
}
/** Read/caching preparation only. The canonical receipt transaction still
 * rechecks the actual Detail, commercial authority, ticket and rate at sync. */
export async function prepareFleetWorkCreation(context:FleetWorkExecutionContext,raw:unknown){
 const body=inputSchema.parse(raw),{actor,state,client}=context;
 const snapshot=await createFleetWorkCanonicalService(context).fleetDetailSnapshot({...actor},body.detailId),grant=state.grants.find(row=>row.userId===actor.userId);
 const ownDriver=snapshot.detail.driverUserId===actor.userId&&grant?.roles.includes("driver");
 if(!state.enabled||!grant||!snapshot.detail.accessGroupIds.some(id=>grant.fleetIds.includes(id))||!ownDriver&&(!grant.roles.some(role=>["fleet_manager","dispatcher"].includes(role))||!grant.siteIds.includes(body.billingSiteId)))throw new FleetError("fleet.work_preparation_forbidden",403);
 const site=(await readFleetAuthoritySites(client,actor.companyId,{siteIds:[body.billingSiteId],activeOnly:true}))[0];if(!site)throw new FleetError("fleet.ticket_site_forbidden",403);
 let ticket:null|{id:number;version:number;serviceId:number}=null;
 if(body.ticketId){
  const row=(await client.query("SELECT id,site_location_id,status,work_type_id,fleet_plan FROM tickets WHERE id=$1 AND vendor_id=$2",[body.ticketId,actor.companyId])).rows[0];
  if(!row||row.site_location_id!==body.billingSiteId)throw new FleetError("fleet.billing_ticket_mismatch",404);
  if(!isFleetBillingV2TicketOpen(row.status)||site.fleet_ticket_policy?.mode==="singles")throw new FleetError("fleet.ticket_closed");
  if(row.fleet_plan?.billingVersion===2){const plan=FleetTicketBillingV2Schema.parse(row.fleet_plan);if(!plan.batchingAllowed||plan.finalizedAt||plan.finalizationOperationId)throw new FleetError("fleet.ticket_closed");ticket={id:row.id,version:plan.revision,serviceId:row.work_type_id};}
  else {const plan=FleetTicketPlanSchema.parse(row.fleet_plan);if(plan.mode!=="batch"||plan.closedAt||plan.finalizationOperationId)throw new FleetError("fleet.ticket_closed");ticket={id:row.id,version:plan.version,serviceId:row.work_type_id};}
 }
 return FleetWorkPreparationSchema.parse({snapshot,billingSiteId:site.id,partnerId:site.partner_id,ticket,serviceTemplates:(await readFleetOfferedTemplates(client,actor.companyId)).flatMap(row=>row.template?.enabled?[row.template]:[])});
}
