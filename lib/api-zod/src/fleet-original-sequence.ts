import {FleetWorkCommandSchema,type FleetWorkCommand,type FleetWorkReference,type FleetWorkScope} from "./fleet-work";
import {FleetInspectionSchema,FleetLoadSchema,FleetRunRecordSchema,type FleetRun} from "./fleet";
import {fleetDetailSnapshotIdentityMatches,type FleetDetailSnapshot} from "./fleet-details";
import {previewFleetRunActions,type FleetRunPreview} from "./fleet-run-preview";

export type FleetOriginalReport={command:FleetWorkCommand;fingerprint:string;receivedAt:string};
type Reason="original_scope_changed"|"original_assignment_changed"|"original_reference_changed"|"duplicate_original"|"original_sequence_conflict"|"component_inspection_incomplete"|"capture_clock_uncertain"|"unsupported_original_action";
export type FleetOriginalSequence={status:"closed_reports_ready_for_review"|"awaiting_original_close_report"|"requires_source_review";canonicalApplied:false;physicalProofVerified:false;originalDriverUserId:number;reportedClosedAt:string|null;sourceOperationIds:string[];reasons:Reason[];projection:FleetRunPreview|null;reports:{inspections:FleetRun["inspections"];loads:FleetRun["loads"];records:FleetRun["records"]}};
const sameScope=(a:FleetWorkScope,b:FleetWorkScope)=>a.userId===b.userId&&a.owner.type===b.owner.type&&a.owner.id===b.owner.id&&a.membershipId===b.membershipId&&a.sessionVersion===b.sessionVersion&&a.deviceId===b.deviceId&&a.provisioningId===b.provisioningId;
const sameReference=(a:FleetWorkReference,b:FleetWorkReference)=>a.type===b.type&&a.kind===b.kind&&a.id===b.id&&(a.type!=="canonical"||b.type==="canonical"&&a.version===b.version);
const sameIdentity=(a:FleetWorkReference,b:FleetWorkReference)=>a.type===b.type&&a.kind===b.kind&&a.id===b.id;
/** Qualifies reports only, after the SERVER independently reads private originals
 * and the exact saved historical assignment. A caller-supplied snapshot/hash is
 * not that verification. Never execute these actions or reserve today's Detail.
 * All imported reports still require separate office source/charge review. */
export function qualifyFleetOriginalReports(input:{run:FleetRun;snapshot:FleetDetailSnapshot;scope:FleetWorkScope;activity:FleetWorkReference;ticket:FleetWorkReference;sources:readonly FleetOriginalReport[]}):FleetOriginalSequence{
 const {run,snapshot,scope,activity,ticket}=input,reasons:Reason[]=[],fail=(reason:Reason)=>{if(!reasons.includes(reason))reasons.push(reason);};
 const result:FleetOriginalSequence={status:"awaiting_original_close_report",canonicalApplied:false,physicalProofVerified:false,originalDriverUserId:snapshot.detail.driverUserId,reportedClosedAt:null,sourceOperationIds:[],reasons,projection:null,reports:{inspections:structuredClone(run.inspections),loads:structuredClone(run.loads),records:structuredClone(run.records)}};
 if(scope.owner.type!=="vendor"||scope.owner.id!==run.companyId||scope.userId!==run.driverUserId||snapshot.detail.driverUserId!==run.driverUserId)fail("original_scope_changed");
 if(snapshot.detail.companyId!==run.companyId||snapshot.carrierOfRecordId!==run.companyId||snapshot.detail.vehicleAssetId!==run.vehicleAssetId||(snapshot.rigPackage?.components.find(c=>c.role==="trailer")?.assetId??null)!==run.trailerAssetId)fail("original_assignment_changed");
 if(activity.kind!=="activity"||activity.id!==run.id||activity.type==="canonical"&&activity.version!==run.version||ticket.kind!=="ticket"||ticket.type==="canonical"&&run.linkedTicketId!==ticket.id)fail("original_reference_changed");
 const actions:Array<Extract<FleetWorkCommand,{kind:"activity.action"}>>=[],seen=new Set<string>();
 for(const source of input.sources){
  const parsed=FleetWorkCommandSchema.safeParse(source.command);
  if(!parsed.success||!Number.isFinite(Date.parse(source.receivedAt))||!/^[a-f0-9]{64}$/.test(source.fingerprint)){fail("original_sequence_conflict");continue;}
  const c=parsed.data;
  if(seen.has(c.operationId)){fail("duplicate_original");continue;}seen.add(c.operationId);result.sourceOperationIds.push(c.operationId);
  if(!sameScope(c.scope,scope))fail("original_scope_changed");
  if(Date.parse(c.capturedAt)>Date.parse(source.receivedAt)+300000)fail("capture_clock_uncertain");
  if(c.kind==="activity.create"){
   if(activity.type!=="local"||c.payload.activityId!==activity.id||!sameReference(c.payload.billing.ticket,ticket))fail("original_reference_changed");
   if(!fleetDetailSnapshotIdentityMatches(snapshot,c.payload.detailSnapshot))fail("original_assignment_changed");
   continue;
  }
  // A canonical activity revision progresses with its reported actions. The
  // contiguous expectedVersion sequence is checked below; never rebase it.
  if(!("activity" in c.payload)||!sameIdentity(c.payload.activity,activity)||!("ticket" in c.payload)||!sameIdentity(c.payload.ticket as FleetWorkReference,ticket)){fail("original_reference_changed");continue;}
  if(c.kind==="activity.action"){
   if(!fleetDetailSnapshotIdentityMatches(snapshot,c.payload.baseAssignment))fail("original_assignment_changed");
   actions.push(c);
  }else if(c.kind==="evidence.stage"){
   if(!fleetDetailSnapshotIdentityMatches(snapshot,c.payload.assignment))fail("original_assignment_changed");
  }else if(c.kind!=="quantity.record"&&c.kind!=="activity.note")fail("unsupported_original_action");
 }
 actions.sort((a,b)=>a.payload.action.expectedVersion-b.payload.action.expectedVersion);
 let previousTime:number|null=null;
 for(const c of actions){const time=Date.parse(c.capturedAt);if(previousTime!==null&&time<previousTime)fail("capture_clock_uncertain");previousTime=time;
  const a=c.payload.action;
  if(a.action==="inspect"){
   const ids=[snapshot.detail.vehicleAssetId,...(snapshot.rigPackage?.components.map(c=>c.assetId)??[])];
   if(a.inspectedAssetIds?.length!==ids.length||new Set(a.inspectedAssetIds).size!==ids.length||!ids.every(id=>a.inspectedAssetIds!.includes(id)))fail("component_inspection_incomplete");
  }
 }
 if(!reasons.length){try{result.projection=previewFleetRunActions(run,actions.map(c=>c.payload.action));}catch{fail("original_sequence_conflict");}}
 // Materialize ONLY actual original user reports. Receipt time remains distinct
 // from captured time; no canonical acknowledge/start/inspection event is made.
 let currentStopId=run.currentStopId;
 if(!reasons.length)for(const c of actions){
  const source=input.sources.find(s=>s.command.operationId===c.operationId)!,a=c.payload.action,recordedAt=new Date(source.receivedAt).toISOString(),capturedAt=new Date(c.capturedAt).toISOString();
  if(a.action==="inspect")result.reports.inspections.push({source:"user_report",driverUserId:run.driverUserId,vehicleAssetId:run.vehicleAssetId,trailerAssetId:run.trailerAssetId,inspectedAssetIds:a.inspectedAssetIds,responses:a.inspectionResponses,outcome:a.inspectionOutcome!,notes:a.notes!,recordedByUserId:c.scope.userId,recordedAt});
  else if(a.action==="record_meter"||a.action==="record_fuel")result.reports.records.push({id:c.operationId,vehicleAssetId:run.vehicleAssetId,kind:a.action==="record_meter"?"meter":"fuel",quantity:a.quantity??null,reading:a.reading??null,unit:a.unit!,notes:a.notes!,source:"user_report",recordedByUserId:c.scope.userId,recordedAt,capturedAt});
  else if(a.action==="arrive_stop")currentStopId=a.stopId!;
  else if(a.action==="depart_stop")currentStopId=null;
  else if(a.action==="record_load")result.reports.loads.push({id:a.loadId!,pickupStopId:currentStopId!,deliveryStopId:null,commodity:a.commodity!,quantity:a.quantity!,unit:a.unit!,manifestReference:a.manifestReference!,manifestValues:a.manifestValues,deliveryReference:null,recordedByUserId:c.scope.userId,recordedAt,deliveredAt:null,source:"user_report"});
  else if(a.action==="record_delivery"){const load=result.reports.loads.find(l=>l.id===a.loadId)!;load.deliveryReference=a.deliveryReference!;load.deliveryStopId=currentStopId;load.deliveredAt=recordedAt;}
  else if(a.action==="submit_closeout")result.reportedClosedAt=capturedAt;
 }
 if(reasons.length){result.status="requires_source_review";result.projection=null;result.reportedClosedAt=null;result.reports={inspections:[],loads:[],records:[]};}
 else if(result.reportedClosedAt&&result.projection?.status==="submitted_for_review")result.status="closed_reports_ready_for_review";
 // The same canonical report schemas enforce existing per-record shape bounds;
 // retained source history itself remains itemized and is never truncated here.
 if(result.status==="closed_reports_ready_for_review"){
  result.reports.inspections.forEach(record=>FleetInspectionSchema.parse(record));
  result.reports.loads.forEach(record=>FleetLoadSchema.parse(record));
  result.reports.records.forEach(record=>FleetRunRecordSchema.parse(record));
 }
 return result;
}
