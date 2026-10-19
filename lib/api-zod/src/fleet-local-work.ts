import {mergeFleetTemplateProfile} from "./fleet-service-template";
import {FleetRunSchema,type FleetRun,type FleetDefinition} from "./fleet";
import type {FleetWorkState} from "./fleet-work-state";
/** Device form projections are explicitly pending, never a reservation, canonical
 * event, financial approval or map telemetry. Originals remain in the journal. */
export function projectFleetLocalActivities(entries:FleetWorkState["entries"],userId:number,canonical:readonly FleetRun[],groups:readonly FleetDefinition[]=[]):FleetRun[]{
 const runs:FleetRun[]=[];
 for(const row of entries){const c=row.command;if(c.kind!=="activity.create"||c.scope.userId!==userId||row.delivery.state==="retained")continue;const p=c.payload;
 const receipt=row.delivery.receipt,ref=receipt&&(receipt.status==="applied"||receipt.status==="duplicate")?receipt.canonicalReferences.find(r=>r.kind==="activity"):null;
 if(canonical.some(r=>r.id===(ref?.id??p.activityId)))continue;
 if(!p.originStopId||!p.billing.billingSiteId)continue;
 const snapshot=p.detailSnapshot,detail=snapshot.detail,origin=p.route.origin.type==="canonical"?p.route.origin.location:undefined;
 const stops=[{id:p.originStopId,siteId:p.billing.billingSiteId,kind:"pickup" as const,sequence:0,cycleId:p.route.stops[0]?.cycleId??null,...(origin?{destination:origin}:{})},...p.route.stops.map((s,i)=>({id:s.id,siteId:p.billing.billingSiteId!,kind:s.kind,sequence:i+1,cycleId:s.cycleId,...(s.location.type==="canonical"?{destination:s.location.location}:{}),...(s.instructions?{instructions:s.instructions}:{})}))];
 runs.push(FleetRunSchema.parse({id:p.activityId,localWork:{createOperationId:c.operationId,originStopId:p.originStopId,snapshot,ticket:p.billing.ticket,state:"pending_server_acceptance"},companyId:c.scope.owner.id,fleetId:p.accessGroupId??detail.accessGroupIds[0],...(p.serviceTemplate?{serviceTemplate:p.serviceTemplate}:{}),operationalProfile:p.serviceTemplate?mergeFleetTemplateProfile(groups.find(g=>g.id===(p.accessGroupId??detail.accessGroupIds[0]))?.operationalProfile,p.serviceTemplate.profile):groups.find(g=>g.id===(p.accessGroupId??detail.accessGroupIds[0]))?.operationalProfile,title:p.title,driverUserId:detail.driverUserId,vehicleAssetId:detail.vehicleAssetId,trailerAssetId:snapshot.rigPackage?.components.find(x=>x.role==="trailer")?.assetId??null,siteIds:[p.billing.billingSiteId],status:"draft",phase:null,version:1,stops,loads:[],inspections:[],records:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:p.billing.ticket.type==="canonical"?p.billing.ticket.id:null,allowedActions:detail.driverUserId===userId&&!['needs_reconciliation','denied'].includes(row.delivery.state)?["dispatch"]:[],labels:{driverName:snapshot.labels.driver,vehicleName:snapshot.labels.truck,trailerName:null,sites:[]},...(p.route.plannedWindow?{schedule:{plannedStartAt:p.route.plannedWindow.startAt,plannedEndAt:p.route.plannedWindow.endAt,timezone:p.route.plannedWindow.timeZone}}:{}),workOrigin:detail.driverUserId===c.scope.userId?"driver_unplanned":"dispatch"}));
 }
 return runs;
}
