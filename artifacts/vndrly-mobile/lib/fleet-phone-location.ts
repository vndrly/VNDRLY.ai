import { FleetLocationInputSchema, FleetLocationObservationSchema, type FleetLocationInput, type FleetLocationObservation, type FleetOverview, type FleetRun } from "@workspace/api-zod";
export type FleetVerifiedAccount = NonNullable<FleetOverview["accountScope"]>;
export type FleetPhoneLocationState = { state: "stopped" | "checking" | "sharing" | "consent_required" | "permission_required" | "unavailable"; message: string; lastAccepted: FleetLocationObservation | null };
type Sample = { latitude: number; longitude: number; accuracy: number | null; timestamp: number };
type Dependencies = {
  readCurrent(): Promise<{account: FleetVerifiedAccount; run: FleetRun}>;
  consent(): Promise<boolean>;
  permission(): Promise<boolean>;
  deviceId(): Promise<string>;
  sample(): Promise<Sample>;
  post(input: FleetLocationInput): Promise<unknown>;
  operationId(): string;
  contextCurrent(): boolean;
  changed(state: FleetPhoneLocationState): void;
};
const assignment = (run: FleetRun) => JSON.stringify([run.id,run.companyId,run.driverUserId,run.vehicleAssetId,run.trailerAssetId]);
/** Foreground device data only. Cached run projections cannot authorize a sample. */
export function createFleetPhoneLocationCollector(account: FleetVerifiedAccount, deps: Dependencies, initialRun?: FleetRun) {
  let generation=0, active=false, busy=false;
  let pending: {input:FleetLocationInput;assignment:string} | null=null;
  let pinnedAssignment=initialRun?assignment(initialRun):null;
  let state: FleetPhoneLocationState={state:"stopped",message:"Phone sharing is stopped.",lastAccepted:null};
  const emit=(status:FleetPhoneLocationState["state"],message:string)=>{state={...state,state:status,message};deps.changed(state);};
  function stop(message="Phone sharing is stopped.", discard=false) {active=false;generation++;if(discard){pending=null;state={...state,lastAccepted:null};}emit("stopped",message);}
  function start() {active=true;generation++;emit("checking","Checking current duty, device consent and location permission.");}
  async function poll() {
    if(!active || busy)return;
    busy=true;const request=generation;
    const current=()=>active && generation===request && deps.contextCurrent();
    const checked=()=>{if(!current()){if(active && generation===request)stop("The account or device context changed. Phone sharing stopped.",true);return false;}return true;};
    try {
      if(!checked())return;
      const authority=await deps.readCurrent();if(!checked())return;
      if(authority.account.userId!==account.userId || authority.account.companyId!==account.companyId || authority.account.membershipId!==account.membershipId || authority.account.sessionVersion!==account.sessionVersion || authority.run.driverUserId!==account.userId || authority.run.companyId!==account.companyId){stop("The verified account or assignment changed. Phone sharing stopped.",true);return;}
      if(authority.run.status!=="in_progress" || authority.run.phase==="paused"){stop("This run is paused or no longer active. Phone sharing stopped.");return;}
      if(!await deps.consent()){if(checked()){active=false;pending=null;emit("consent_required","Device consent is required. No phone position was sent.");}return;}if(!checked())return;
      if(!await deps.permission()){if(checked()){active=false;pending=null;emit("permission_required","Location permission is required. No phone position was sent.");}return;}if(!checked())return;
      const binding=assignment(authority.run);
      if(pinnedAssignment && pinnedAssignment!==binding){stop("The equipment assignment changed. Phone sharing stopped.",true);return;}
      pinnedAssignment=binding;
      if(pending && pending.assignment!==binding){stop("The equipment assignment changed. Phone sharing stopped.",true);return;}
      if(!pending){
        const deviceId=await deps.deviceId();if(!checked())return;
        const sample=await deps.sample();if(!checked())return;
        pending={assignment:binding,input:FleetLocationInputSchema.parse({operationId:deps.operationId(),expectedVersion:authority.run.version,deviceId,latitude:sample.latitude,longitude:sample.longitude,accuracyMeters:sample.accuracy,recordedAt:new Date(sample.timestamp).toISOString()})};
      }
      // Recheck consent after an OS location request that may have taken time.
      if(!await deps.consent()){if(checked()){active=false;pending=null;emit("consent_required","Device consent could not be verified. Phone sharing stopped.");}return;}if(!checked())return;
      if(!await deps.permission()){if(checked()){active=false;pending=null;emit("permission_required","Location permission was revoked. Phone sharing stopped.");}return;}if(!checked())return;
      const result=FleetLocationObservationSchema.parse(await deps.post(pending.input));if(!checked())return;
      if(result.runId!==authority.run.id || result.driverUserId!==account.userId || result.vehicleAssetId!==authority.run.vehicleAssetId)throw new Error("Phone location outcome could not be verified.");
      pending=null;state={...state,lastAccepted:result};
      emit(result.freshness==="recent"?"sharing":"unavailable",result.freshness==="recent"?"This driver's phone position was accepted. It is not truck telemetry or proof of arrival.":"The phone observation was accepted but its location is stale or unavailable.");
    } catch(error) {
      if(!checked())return;
      const status=(error as {status?:number}).status;
      if(status && status>=400 && status<500){pending=null;stop("Current duty, permission or run revision was refused. Phone sharing stopped.");}
      else emit("unavailable",pending?"Phone position delivery is unverified. The exact report will be retried while current duty and consent remain valid.":"Phone location is unavailable. No position was sent.");
    } finally {busy=false;}
  }
  return {start,stop,poll,snapshot:()=>state};
}
