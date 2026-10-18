import {z} from "zod/v4";
import {isDeepStrictEqual} from "node:util";
import {FleetReconciliationCaseSchema,FleetRunSchema,FleetDetailSchema,FleetRigPackageSchema,FleetRecoverySourcePageSchema,fleetDetailSnapshotIdentityMatches,type FleetWorkCommand,type FleetWorkReference,type FleetDetailSnapshot} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {readFleetWorkOriginal} from "./fleet-work-originals";
import {authorizeFleetRecovery} from "./fleet-reconciliation";
import {readFleetResourceRecord} from "./fleet-resource-store";
import {FleetError} from "./fleet-repository";
const querySchema=z.object({cursor:z.string().regex(/^\d{1,18}:\d{1,18}$/).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
function activity(command:FleetWorkCommand):FleetWorkReference|null{return command.kind==="activity.create"?{type:"local",kind:"activity",id:command.payload.activityId}:"activity" in command.payload?command.payload.activity:null;}
const sameIdentity=(a:FleetWorkReference|null,b:FleetWorkReference|null)=>!!a&&!!b&&a.type===b.type&&a.kind===b.kind&&a.id===b.id;
/** Only allowlisted operational summaries leave private original storage.
 * This reads historical sources; it cannot replay a driver or reserve today's Detail. */
export async function readFleetRecoverySources(context:FleetWorkExecutionContext,caseId:string,raw:unknown){
 const {client,actor}=context,input=querySchema.parse(raw),row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-case' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,z.uuid().parse(caseId)])).rows[0];
 if(!row)throw new FleetError("fleet.recovery_forbidden",403);
 const value=FleetReconciliationCaseSchema.parse(row.tool_output),original=await readFleetWorkOriginal(client,actor.companyId,value.operationId),permission=await authorizeFleetRecovery(context,value,original.command);
 if(!permission.office)throw new FleetError("fleet.recovery_forbidden",403);
 const reference=activity(original.command);if(!reference)throw new FleetError("fleet.recovery_requires_source_review",409);
 let snapshot:FleetDetailSnapshot;
 if(original.command.kind==="activity.create"){
  snapshot=original.command.payload.detailSnapshot;
  const detail=FleetDetailSchema.parse(await readFleetResourceRecord(client,actor.companyId,"fleet-detail",snapshot.detail.id,snapshot.detail.version));
  const rig=snapshot.rigPackage?FleetRigPackageSchema.parse(await readFleetResourceRecord(client,actor.companyId,"fleet-rig-package",snapshot.rigPackage.id,snapshot.rigPackage.version)):null;
  if(!isDeepStrictEqual(detail,snapshot.detail)||!isDeepStrictEqual(rig,snapshot.rigPackage)||detail.companyId!==actor.companyId)throw new FleetError("fleet.original_assignment_unverified",409);
 }else{
  if(reference.type!=="canonical")throw new FleetError("fleet.original_assignment_unverified",409);
  const saved=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",[actor.companyId,reference.id,String(reference.version)])).rows[0];
  if(!saved)throw new FleetError("fleet.original_assignment_unverified",409);
  const run=FleetRunSchema.parse(saved.tool_output);if(!run.resourceAssignment||run.companyId!==actor.companyId)throw new FleetError("fleet.original_assignment_unverified",409);snapshot=run.resourceAssignment.snapshot;
  if("baseAssignment" in original.command.payload&&!fleetDetailSnapshotIdentityMatches(snapshot,original.command.payload.baseAssignment))throw new FleetError("fleet.original_assignment_unverified",409);
 }
 const owner=`fleet-work-original:${actor.companyId}:${value.scope.userId}:${value.scope.provisioningId}`,parts=input.cursor?.split(":");
 const after=parts?.[0]??"0",ceiling=parts?.[1]??String((await client.query("SELECT COALESCE(MAX(id),0) AS id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2",[actor.companyId,owner])).rows[0].id);
 if(BigInt(after)>BigInt(ceiling))throw new FleetError("fleet.invalid_cursor",400);
 const candidates=(await client.query("SELECT id,created_at,target_id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-original' AND tool_output->>'owner'=$2 AND id>$3::bigint AND id<=$4::bigint ORDER BY id LIMIT $5",[actor.companyId,owner,after,ceiling,input.limit+1])).rows;
 const included=candidates.slice(0,input.limit),sources=[];
 for(const candidate of included){
  const retained=await readFleetWorkOriginal(client,actor.companyId,candidate.target_id),command=retained.command;
  if(!isDeepStrictEqual(command.scope,value.scope))throw new FleetError("fleet.original_identity_conflict",409);
  if(!sameIdentity(activity(command),reference))continue;
  const action=command.kind==="activity.action"?command.payload.action:null,quantity=command.kind==="quantity.record"?command.payload.evidence:null,evidence=command.kind==="evidence.stage"?command.payload:null;
  const assignment="baseAssignment" in command.payload?command.payload.baseAssignment:command.kind==="evidence.stage"?command.payload.assignment:command.kind==="activity.create"?command.payload.detailSnapshot:null;
  sources.push({operationId:command.operationId,fingerprint:retained.fingerprint,kind:command.kind,reportedByUserId:command.scope.userId,driverReport:command.scope.userId===snapshot.detail.driverUserId,assignmentMatches:assignment?fleetDetailSnapshotIdentityMatches(snapshot,assignment):true,capturedAt:command.capturedAt,receivedAt:new Date(candidate.created_at).toISOString(),timeZone:command.timeZone,action:action?.action??null,expectedVersion:action?.expectedVersion??null,notes:command.kind==="activity.note"?command.payload.notes:action?.notes??null,quantity:quantity?.quantity??(action?.quantity!==undefined?String(action.quantity):null),unit:quantity?.unit??action?.unit??null,reading:action?.reading??null,commodity:action?.commodity??null,inspectionOutcome:action?.inspectionOutcome??null,evidence:evidence?{kind:evidence.kind,byteSize:evidence.byteSize,sha256:evidence.sha256,contentType:evidence.contentType}:null});
 }
 return FleetRecoverySourcePageSchema.parse({caseId:value.id,caseVersion:value.version,source:"retained_original_reports",canonicalApplied:false,historicalDetailVerified:true,detail:{id:snapshot.detail.id,name:snapshot.detail.name,version:snapshot.detail.version,driverUserId:snapshot.detail.driverUserId,vehicleAssetId:snapshot.detail.vehicleAssetId,rigPackageId:snapshot.rigPackage?.id??null,componentAssetIds:snapshot.rigPackage?.components.map(c=>c.assetId)??[]},sources,scannedCount:included.length,nextCursor:candidates.length>input.limit?`${included.at(-1)!.id}:${ceiling}`:null});
}
