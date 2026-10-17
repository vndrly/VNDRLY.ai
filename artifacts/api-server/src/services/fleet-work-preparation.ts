import {z} from "zod/v4";
import {FleetWorkPreparationSchema,FleetTicketBillingV2Schema,FleetTicketPlanSchema} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {createFleetWorkCanonicalService} from "./fleet-work-canonical";
import {readFleetAuthoritySites} from "./fleet-commercial-authority";
import {isFleetBillingV2TicketOpen} from "./fleet-billing-v2";
import {FleetError} from "./fleet-repository";
const inputSchema=z.object({detailId:z.uuid(),billingSiteId:z.number().int().positive(),ticketId:z.number().int().positive().nullable()}).strict();
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
 return FleetWorkPreparationSchema.parse({snapshot,billingSiteId:site.id,partnerId:site.partner_id,ticket});
}
