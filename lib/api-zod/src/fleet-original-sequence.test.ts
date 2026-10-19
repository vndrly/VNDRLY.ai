import {expect,it} from "vitest";
import * as recovery from "./fleet-original-sequence";
import {FleetRunSchema,type FleetActionInput} from "./fleet";
import {FleetWorkCommandSchema} from "./fleet-work";
import {FleetDetailSnapshotSchema} from "./fleet-details";
const uuid=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const at="2026-10-16T18:00:00.000Z",receivedAt="2026-10-16T20:00:00.000Z";
function fixture(){
 const scope={owner:{type:"vendor" as const,id:11},userId:7,membershipId:9,sessionVersion:2,deviceId:uuid(1),provisioningId:uuid(2)};
 const snapshot=FleetDetailSnapshotSchema.parse({detail:{id:uuid(3),companyId:11,version:1,name:"Synthetic Detail",vehicleAssetId:uuid(4),rigPackageId:uuid(5),rigPackageVersion:1,driverUserId:7,accessGroupIds:[uuid(6)],effectiveFrom:at,effectiveUntil:null,archivedAt:null},rigPackage:{id:uuid(5),companyId:11,version:1,name:"Synthetic rig",components:[{assetId:uuid(8),role:"trailer",sequence:0},{assetId:uuid(9),role:"dolly",sequence:1}],effectiveFrom:at,effectiveUntil:null,archivedAt:null},labels:{truck:"Truck",driver:"Driver",rigPackage:"Rig",components:[{assetId:uuid(8),label:"Trailer"},{assetId:uuid(9),label:"Dolly"}]},carrierOfRecordId:11,snapshottedAt:at});
 const ticket={type:"local" as const,kind:"ticket" as const,id:uuid(10)},activity={type:"local" as const,kind:"activity" as const,id:uuid(11)};
 const run=FleetRunSchema.parse({id:activity.id,companyId:11,fleetId:uuid(6),title:"Original crude transport",driverUserId:7,vehicleAssetId:uuid(4),trailerAssetId:uuid(8),status:"dispatched",phase:null,version:2,siteIds:[13],stops:[{id:uuid(12),siteId:13,kind:"pickup",sequence:0},{id:uuid(13),siteId:13,kind:"delivery",sequence:1}],loads:[],inspections:[],records:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:null,allowedActions:[]});
 const actions:Array<Omit<FleetActionInput,"operationId"|"expectedVersion">>=[{action:"acknowledge"},{action:"inspect",inspectionOutcome:"passed",notes:"Original driver inspection",inspectedAssetIds:[uuid(4),uuid(8),uuid(9)]},{action:"record_meter",reading:100,unit:"miles",notes:"Start reading"},{action:"start"},{action:"arrive_stop",stopId:uuid(12)},{action:"record_load",loadId:uuid(14),commodity:"Crude",quantity:100,unit:"barrel",manifestReference:"Original manifest"},{action:"depart_stop",stopId:uuid(12)},{action:"arrive_stop",stopId:uuid(13)},{action:"record_delivery",loadId:uuid(14),deliveryReference:"Original receipt"},{action:"depart_stop",stopId:uuid(13)},{action:"record_meter",reading:110,unit:"miles",notes:"End reading"},{action:"submit_closeout"}];
 const sources=actions.map((action,index)=>{const operationId=uuid(100+index),capturedAt=new Date(Date.parse(at)+index*60000).toISOString();return {command:FleetWorkCommandSchema.parse({version:2,kind:"activity.action",scope,operationId,capturedAt,timeZone:"America/Chicago",dependencies:[],payload:{activity,ticket,baseAssignment:snapshot,action:{...action,operationId,expectedVersion:run.version+index,capturedAt}}}),fingerprint:"a".repeat(64),receivedAt};});
 return {run,snapshot,scope,ticket,activity,sources};
}
it("qualifies the original driver sequence without mutating canonical work or converting reports into physical proof",()=>{
 const f=fixture(),before=JSON.stringify(f),result=recovery.qualifyFleetOriginalReports(f);
 expect(result).toMatchObject({status:"closed_reports_ready_for_review",canonicalApplied:false,physicalProofVerified:false,reportedClosedAt:f.sources.at(-1)!.command.capturedAt,originalDriverUserId:7,sourceOperationIds:f.sources.map(s=>s.command.operationId)});
 expect(result.projection?.status).toBe("submitted_for_review");expect(JSON.stringify(f)).toBe(before);
});
it("refuses gaps, duplicate revisions, changed historical Details and missing component inspections instead of rebasing",()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.sources.splice(3,1);},
  (f:ReturnType<typeof fixture>)=>{f.sources.push(structuredClone(f.sources[3]));},
  (f:ReturnType<typeof fixture>)=>{const c=f.sources[3].command;if(c.kind==="activity.action")c.payload.baseAssignment.detail.version++;},
  (f:ReturnType<typeof fixture>)=>{const c=f.sources[1].command;if(c.kind==="activity.action")c.payload.action.inspectedAssetIds=[uuid(4),uuid(8)];},
 ]){const f=fixture();change(f);expect(recovery.qualifyFleetOriginalReports(f).status).toBe("requires_source_review");}
});
it("keeps clock uncertainty and absent closure visible and never supplies another driver's acknowledgement",()=>{
 const clock=fixture();clock.sources[3].command.capturedAt="2027-01-01T00:00:00.000Z";if(clock.sources[3].command.kind==="activity.action")clock.sources[3].command.payload.action.capturedAt=clock.sources[3].command.capturedAt;
 expect(recovery.qualifyFleetOriginalReports(clock)).toMatchObject({status:"requires_source_review",reasons:expect.arrayContaining(["capture_clock_uncertain"])});
 const open=fixture();open.sources.pop();expect(recovery.qualifyFleetOriginalReports(open)).toMatchObject({status:"awaiting_original_close_report",reportedClosedAt:null});
 const other=fixture();other.scope.userId=99;expect(recovery.qualifyFleetOriginalReports(other)).toMatchObject({status:"requires_source_review",reasons:expect.arrayContaining(["original_scope_changed"])});
});
it("reads contiguous original canonical revisions from the saved base without requiring a fresh arrival report at an already recorded stop",()=>{
 const f=fixture();
 f.run.status="in_progress";f.run.phase="at_pickup";f.run.currentStopId=uuid(12);f.run.version=7;
 f.run.inspections=[{driverUserId:7,vehicleAssetId:uuid(4),trailerAssetId:uuid(8),inspectedAssetIds:[uuid(4),uuid(8),uuid(9)],outcome:"passed",notes:"Already saved inspection",recordedByUserId:7,recordedAt:at,source:"user_report"}];
 f.run.records=[{id:uuid(200),vehicleAssetId:uuid(4),kind:"meter",quantity:null,reading:100,unit:"miles",notes:"Already saved meter",recordedByUserId:7,recordedAt:at,capturedAt:at,source:"user_report"}];
 const activity={type:"canonical" as const,kind:"activity" as const,id:f.run.id,version:7},ticket={type:"canonical" as const,kind:"ticket" as const,id:123,version:1};f.run.linkedTicketId=ticket.id;
 const sources=f.sources.slice(5).map((s,index)=>{const command=structuredClone(s.command);if(command.kind!=="activity.action")throw Error("Expected driver action");command.payload.activity={...activity,version:7+index};command.payload.ticket=ticket;command.payload.action.expectedVersion=7+index;return {...s,command};});
 const result=recovery.qualifyFleetOriginalReports({...f,activity,ticket,sources});expect(result.status).toBe("closed_reports_ready_for_review");expect(result.reports.loads[0].pickupStopId).toBe(uuid(12));expect(result.reports.loads[0].deliveryStopId).toBe(uuid(13));
});

