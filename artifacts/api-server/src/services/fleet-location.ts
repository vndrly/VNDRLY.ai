import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { FleetRun } from "@workspace/api-zod";
import { FleetLocationInputSchema, FleetLocationObservationSchema, type FleetLocationObservation } from "@workspace/api-zod";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";

type Transaction = <T>(actor: FleetActor, operation: (state: FleetState, client: PoolClient) => Promise<T>) => Promise<T>;
type Permitted = (state: FleetState, actor: FleetActor, run: FleetRun, action: "view" | "dispatch" | "perform_run") => boolean;
type SavedLocation = {operationId: string; fingerprint: string; deviceId: string; assignment: string; observation: FleetLocationObservation};
const assignment = (run: FleetRun) => JSON.stringify([run.id,run.companyId,run.driverUserId,run.vehicleAssetId,run.trailerAssetId]);
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const currentObservation = (observation: FleetLocationObservation, run: FleetRun, now: Date): FleetLocationObservation => ({...observation, freshness: observation.accuracyMeters === null || observation.accuracyMeters > 1000 ? "unavailable" : run.phase === "paused" ? "paused" : now.getTime()-Date.parse(observation.recordedAt)>6*60*1000 ? "stale" : "recent"});

/** Called only from authenticated native-device routes, never an assistant GPS tool. */
export function createFleetLocationOperations(transaction: Transaction, permitted: Permitted, clock: ()=>Date = ()=>new Date()) {
  const locate = (state: FleetState, actor: FleetActor, runId: string, action: "view"|"perform_run") => {
    const run=state.runs.find(item=>item.id===runId);
    if(!run || !permitted(state,actor,run,action)) throw new FleetError("fleet.run_not_found",404);
    return run;
  };
  const readObservations = async(state: FleetState, client: PoolClient, actor: FleetActor) => {
    const runIds=state.runs.filter(run=>run.status==="in_progress"&&permitted(state,actor,run,"view")).map(run=>run.id);
    if(!runIds.length)return [];
    const rows=await client.query("SELECT tool_output FROM (SELECT DISTINCT ON(target_id) target_id,tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-location' AND target_id=ANY($2::text[]) ORDER BY target_id,(tool_output->'observation'->>'recordedAt')::timestamptz DESC,id DESC) latest WHERE EXISTS(SELECT 1 FROM location_consents c WHERE c.user_id=(tool_output->'observation'->>'driverUserId')::int AND c.device_id=tool_output->>'deviceId' AND c.revoked_at IS NULL)",[actor.companyId,runIds]);
    return rows.rows.flatMap(row=>{
      const saved=row.tool_output as SavedLocation, parsed=FleetLocationObservationSchema.safeParse(saved.observation);
      if(!parsed.success) return [];
      const run=state.runs.find(item=>item.id===parsed.data.runId);
      if(!run || run.status!=="in_progress" || !permitted(state,actor,run,"view") || saved.assignment!==assignment(run))return [];
      return [currentObservation(parsed.data,run,clock())];
    });
  };
  return {
    record: (actor: FleetActor, runId: string, input: unknown) => {
      const command=FleetLocationInputSchema.parse(input);
      const boundActor={...actor,runId};
      return transaction(boundActor,async(state,client)=>{
        const run=locate(state,boundActor,runId,"perform_run");
        if(run.driverUserId!==actor.userId || run.status!=="in_progress" || run.phase==="paused") throw new FleetError("fleet.active_driver_tracking_required",403);
        const consent=await client.query("SELECT id FROM location_consents WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL FOR SHARE",[actor.userId,command.deviceId]);
        if(!consent.rows.length) throw new FleetError("fleet.device_location_consent_required",403);
        const previous=await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-location-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,command.operationId]);
        const hash=fingerprint({runId,userId:actor.userId,...command});
        if(previous.rows.length){const saved=previous.rows[0].tool_output as SavedLocation;if(saved.fingerprint!==hash || saved.assignment!==assignment(run)) throw new FleetError("fleet.location_operation_conflict",409);return currentObservation(FleetLocationObservationSchema.parse(saved.observation),run,clock());}
        if(run.version!==command.expectedVersion) throw new FleetError("fleet.version_conflict",409);
        const now=clock(), age=now.getTime()-Date.parse(command.recordedAt);
        if(age< -30000 || age>24*60*60*1000) throw new FleetError("fleet.location_capture_time_invalid",400);
        const observation=currentObservation(FleetLocationObservationSchema.parse({runId,vehicleAssetId:run.vehicleAssetId,driverUserId:actor.userId,latitude:command.latitude,longitude:command.longitude,accuracyMeters:command.accuracyMeters,recordedAt:command.recordedAt,receivedAt:now.toISOString(),source:"driver_phone",freshness:"recent",physicalProofVerified:false}),run,now);
        const saved: SavedLocation={operationId:command.operationId,fingerprint:hash,deviceId:command.deviceId,assignment:assignment(run),observation};
        for(const [type,id] of [["fleet-location",runId],["fleet-location-operation",command.operationId]]) await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','device','canonical','fleet_phone_location','device-report',$3,$4,$5::jsonb,'completed')",[actor.userId,actor.companyId,type,id,JSON.stringify(saved)]);
        return observation;
      });
    },
    observations: (actor: FleetActor) => transaction(actor,(state,client)=>readObservations(state,client,actor)),
    readObservations,
  };
}
