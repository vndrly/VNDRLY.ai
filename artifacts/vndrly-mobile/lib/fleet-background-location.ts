import { FleetLocationInputSchema, FleetLocationObservationSchema, type FleetLocationInput, type FleetLocationObservation, type FleetRun } from "@workspace/api-zod";
import type { FleetVerifiedAccount } from "./fleet-phone-location";

export type FleetBackgroundBinding = {account:FleetVerifiedAccount;runId:string;vehicleAssetId:string;trailerAssetId:string|null;deviceId:string;pending:FleetLocationInput|null};
export type FleetBackgroundSample = {latitude:number;longitude:number;accuracy:number|null;timestamp:number};
type Dependencies = {
  readCurrent():Promise<{account:FleetVerifiedAccount;run:FleetRun}>;
  consent():Promise<boolean>;permission():Promise<boolean>;contextCurrent():boolean;
  persist(binding:FleetBackgroundBinding):Promise<void>;
  post(input:FleetLocationInput):Promise<unknown>;
  operationId():string;
};
/** An OS callback is a device observation. No cached authority or ticket identity is used. */
export async function deliverFleetBackgroundSample(binding:FleetBackgroundBinding,sample:FleetBackgroundSample,deps:Dependencies):Promise<FleetLocationObservation> {
  const check=()=>{if(!deps.contextCurrent())throw Object.assign(new Error("Background account context changed."),{status:403});};
  check();const current=await deps.readCurrent();check();
  const a=current.account,b=binding.account,r=current.run;
  if(a.userId!==b.userId || a.companyId!==b.companyId || a.membershipId!==b.membershipId || a.sessionVersion!==b.sessionVersion || r.id!==binding.runId || r.companyId!==b.companyId || r.driverUserId!==b.userId || r.vehicleAssetId!==binding.vehicleAssetId || r.trailerAssetId!==binding.trailerAssetId || r.status!=="in_progress" || r.phase==="paused")throw Object.assign(new Error("Current background Fleet duty or assignment was refused."),{status:403});
  if(!await deps.consent() || !await deps.permission())throw Object.assign(new Error("Background device consent or permission is unavailable."),{status:403});check();
  const input=binding.pending ?? FleetLocationInputSchema.parse({operationId:deps.operationId(),expectedVersion:r.version,deviceId:binding.deviceId,latitude:sample.latitude,longitude:sample.longitude,accuracyMeters:sample.accuracy,recordedAt:new Date(sample.timestamp).toISOString()});
  FleetLocationInputSchema.parse(input);
  if(input.deviceId!==binding.deviceId)throw Object.assign(new Error("Background device binding changed."),{status:403});
  // Persist the exact report before transmission so a cold wake or lost response reuses its UUID/body.
  await deps.persist({...binding,pending:input});check();
  if(!await deps.consent() || !await deps.permission())throw Object.assign(new Error("Background consent could not be reverified."),{status:403});check();
  const result=FleetLocationObservationSchema.parse(await deps.post(input));check();
  if(result.runId!==r.id || result.driverUserId!==b.userId || result.vehicleAssetId!==binding.vehicleAssetId)throw new Error("Background report outcome could not be verified.");
  await deps.persist({...binding,pending:null});check();return result;
}
