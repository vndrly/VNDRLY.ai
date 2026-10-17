import {z} from "zod/v4";
import {CreateFleetRunSchema,type FleetRun,type FleetActionInput} from "./fleet";
import {FleetDetailSnapshotSchema} from "./fleet-details";
import {FleetWorkScopeSchema,FleetWorkCommandSchema,type FleetWorkScope} from "./fleet-work";
export const FleetWorkPreparationSchema=z.object({snapshot:FleetDetailSnapshotSchema,billingSiteId:z.number().int().positive(),partnerId:z.number().int().positive(),ticket:z.object({id:z.number().int().positive(),version:z.number().int().positive(),serviceId:z.number().int().positive()}).strict().nullable()}).strict();
export function buildFleetCreateIntent(options:{scope:unknown;preparation:unknown;input:unknown;now:()=>Date;uuid:()=>string}){
 const scope=FleetWorkScopeSchema.parse(options.scope),prepared=FleetWorkPreparationSchema.parse(options.preparation),input=CreateFleetRunSchema.parse(options.input),snapshot=prepared.snapshot,detail=snapshot.detail;
 if(!input.detailSelection||!input.routePlan||input.detailSelection.detailId!==detail.id||input.detailSelection.detailVersion!==detail.version||input.driverUserId!==detail.driverUserId||input.vehicleAssetId!==detail.vehicleAssetId||input.trailerAssetId!==(snapshot.rigPackage?.components.find(row=>row.role==="trailer")?.assetId??null)||!detail.accessGroupIds.includes(input.fleetId))throw Error("Verify the exact saved Detail before capture");
 if(input.stops[0].siteId!==prepared.billingSiteId)throw Error("Original billing site changed");
 const existing=input.billing.mode==="existing_ticket";
 if(input.billing.mode==="existing_ticket"&&(!prepared.ticket||prepared.ticket.id!==input.billing.ticketId))throw Error("Verify the exact open ticket before capture");
 const capturedAt=options.now().toISOString(),serviceId=input.billing.mode==="new_ticket"?input.billing.workTypeId:prepared.ticket!.serviceId;
 const result=FleetWorkCommandSchema.parse({version:2,scope,operationId:input.operationId,capturedAt,timeZone:input.detailSelection.timeZone,dependencies:[],kind:"activity.create",payload:{activityId:options.uuid(),title:input.title,detailReference:{type:"canonical",kind:"detail",id:detail.id,version:detail.version},detailSnapshot:snapshot,route:input.routePlan,runOrderReference:input.runOrderSelection?{type:"canonical",kind:"run_order",...input.runOrderSelection}:null,billing:{choice:existing?"existing_ticket":"new_ticket",ticket:existing?{type:"canonical",kind:"ticket",id:prepared.ticket!.id,version:prepared.ticket!.version}:{type:"local",kind:"ticket",id:options.uuid()},partnerId:prepared.partnerId,billingSiteId:prepared.billingSiteId,afeNumber:input.billing.afeNumber,workDate:input.billing.workDate,currency:"USD",serviceId,agreementReference:null},pricingIntent:{mode:"unpriced",reason:"offline_reference_missing",serviceId,approvalRef:null},capturePolicy:null,compliance:{mode:"warn_only",status:"red",evaluatedAt:capturedAt,warnings:[{category:"regulatory_review",reason:"unverified"}]}}});
 if(result.kind!=="activity.create")throw Error("Invalid Fleet create intent");return result;
}
export function buildFleetActionIntent(scope:FleetWorkScope,run:FleetRun,action:FleetActionInput,now:()=>Date,timeZone:string){
 if(!run.resourceAssignment?.snapshot||!run.ticketReference)throw Error("Verify and cache the exact saved activity and ticket before capture");
 const result=FleetWorkCommandSchema.parse({version:2,scope,operationId:action.operationId,kind:"activity.action",capturedAt:action.capturedAt??now().toISOString(),timeZone,dependencies:[],payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:action.expectedVersion},ticket:{type:"canonical",kind:"ticket",...run.ticketReference},baseAssignment:run.resourceAssignment.snapshot,action}});
 if(result.kind!=="activity.action")throw Error("Invalid Fleet action intent");return result;
}
