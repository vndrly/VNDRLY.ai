import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { z } from "zod/v4";
import { FleetLocationInputSchema, type FleetOverview, type FleetRun } from "@workspace/api-zod";
import { apiFetch } from "./api";
import { captureAuthScope, isAuthScopeCurrent, getUser, getToken, subscribeToken, subscribeUser } from "./auth";
import { getDeviceId } from "./deviceId";
import { hasActiveConsentForThisDevice } from "./locationConsent";
import { isExpoGo } from "./runtime";
import { fleetOfflineByteLength } from "./fleet-offline";
import { deliverFleetBackgroundSample, type FleetBackgroundBinding, type FleetBackgroundSample } from "./fleet-background-location";
import type { FleetVerifiedAccount } from "./fleet-phone-location";

export const FLEET_BACKGROUND_TASK="vndrly-fleet-duty-location";
const KEY="vndrly.fleet-duty-location";
const schema=z.object({enabled:z.boolean(),account:z.object({userId:z.number().int().positive(),companyId:z.number().int().positive(),membershipId:z.number().int().positive(),sessionVersion:z.number().int().nonnegative()}).strict(),runId:z.uuid(),vehicleAssetId:z.uuid(),trailerAssetId:z.uuid().nullable(),deviceId:z.string().min(1).max(200),pending:FleetLocationInputSchema.nullable()}).strict();
type Stored=z.infer<typeof schema>;
export type FleetBackgroundStatus={state:"stopped"|"configured"|"accepted"|"unavailable";message:string;lastAcceptedAt:string|null};
let status:FleetBackgroundStatus={state:"stopped",message:"Background phone sharing is stopped.",lastAcceptedAt:null};
const listeners=new Set<(value:FleetBackgroundStatus)=>void>();
let generation=0,serial:Promise<unknown>=Promise.resolve();
function exclusive<T>(work:()=>Promise<T>):Promise<T>{const task=serial.then(work,work);serial=task.catch(()=>undefined);return task;}
function emit(state:FleetBackgroundStatus["state"],message:string,lastAcceptedAt:string|null=status.lastAcceptedAt){status={state,message,lastAcceptedAt};listeners.forEach(listener=>listener(status));}
export function subscribeFleetBackgroundLocation(listener:(value:FleetBackgroundStatus)=>void){listeners.add(listener);listener(status);return()=>{listeners.delete(listener);};}
async function store(value:Stored){const raw=JSON.stringify(schema.parse(value));if(fleetOfflineByteLength(raw)>1900)throw new Error("Background report exceeds device storage capacity.");await SecureStore.setItemAsync(KEY,raw,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});}
async function read(){const raw=await SecureStore.getItemAsync(KEY);if(!raw)return null;if(fleetOfflineByteLength(raw)>1900)throw new Error("Invalid background device record.");return schema.parse(JSON.parse(raw));}
async function stopOS(){if(!isExpoGo && await Location.hasStartedLocationUpdatesAsync(FLEET_BACKGROUND_TASK))await Location.stopLocationUpdatesAsync(FLEET_BACKGROUND_TASK);}
/** Invalidates callbacks synchronously; serial storage cleanup cannot race a pending publication. */
export function stopFleetBackgroundLocation(clear=true){generation++;if(clear)emit("stopped","Background phone sharing is stopped.",null);return exclusive(async()=>{try{await stopOS();}finally{if(clear)await SecureStore.deleteItemAsync(KEY);else{const value=await read();if(value)await store({...value,enabled:false});}emit("stopped","Background phone sharing is stopped.",clear?null:status.lastAcceptedAt);}});}
async function authority(runId:string){const overview=await apiFetch<FleetOverview>("/api/fleet/overview");if(!overview.accountScope || !overview.capabilities.canDrive)throw Object.assign(new Error("Current Fleet duty verification is required."),{status:403});const run=await apiFetch<FleetRun>(`/api/fleet/runs/${runId}`);return {account:overview.accountScope,run};}
async function permission(){return (await Location.getForegroundPermissionsAsync()).status==="granted" && (await Location.getBackgroundPermissionsAsync()).status==="granted";}

export async function startFleetBackgroundLocation(account:FleetVerifiedAccount,run:FleetRun){
  const request=++generation;
  return exclusive(async()=>{
    if(isExpoGo || !await TaskManager.isAvailableAsync())throw new Error("Background phone sharing requires an installed native build.");
    await stopOS();await getUser();await getToken();const scope=captureAuthScope();
    const current=()=>request===generation && isAuthScopeCurrent(scope);
    const fresh=await authority(run.id);if(!current())throw new Error("Background account context changed.");
    if(fresh.account.userId!==account.userId || fresh.account.companyId!==account.companyId || fresh.account.membershipId!==account.membershipId || fresh.account.sessionVersion!==account.sessionVersion || fresh.run.driverUserId!==account.userId || fresh.run.companyId!==account.companyId || fresh.run.vehicleAssetId!==run.vehicleAssetId || fresh.run.trailerAssetId!==run.trailerAssetId || fresh.run.status!=="in_progress" || fresh.run.phase==="paused")throw new Error("Current background Fleet duty or assignment was refused.");
    if(!await hasActiveConsentForThisDevice() || !await permission() || !current())throw new Error("Background device consent and Always location permission are required.");
    const deviceId=await getDeviceId(),old=await read();if(!current())throw new Error("Background account context changed.");
    const binding:Stored={enabled:true,account,runId:run.id,vehicleAssetId:run.vehicleAssetId,trailerAssetId:run.trailerAssetId,deviceId,pending:null};
    if(old && old.runId===binding.runId && old.vehicleAssetId===binding.vehicleAssetId && old.trailerAssetId===binding.trailerAssetId && old.deviceId===binding.deviceId && old.account.userId===account.userId && old.account.companyId===account.companyId && old.account.membershipId===account.membershipId && old.account.sessionVersion===account.sessionVersion)binding.pending=old.pending;
    else if(old?.pending)throw new Error("A previous background report is unresolved. Stop and discard it before selecting another assignment.");
    await store(binding);if(!current())throw new Error("Background account context changed.");
    try{await Location.startLocationUpdatesAsync(FLEET_BACKGROUND_TASK,{accuracy:Location.Accuracy.Balanced,timeInterval:120000,distanceInterval:50,deferredUpdatesInterval:120000,deferredUpdatesDistance:50,showsBackgroundLocationIndicator:true,pausesUpdatesAutomatically:false,activityType:Location.ActivityType.Other,foregroundService:{notificationTitle:"VNDRLY Fleet phone sharing",notificationBody:"Sharing this phone during your active Fleet run."}});if(!current()){await stopOS();return;}emit("configured","Background phone sharing is configured. OS delivery remains unverified until a report is accepted.");}
    catch(error){await store({...binding,enabled:false});await stopOS();throw error;}
  });
}
export function handleFleetBackgroundSample(sample:FleetBackgroundSample){const request=generation;return exclusive(async()=>{
  let value:Stored|null=null;
  try{
    value=await read();if(!value?.enabled)return;
    const user=await getUser();await getToken();const scope=captureAuthScope();
    if(user?.id!==value.account.userId || user.activeMembershipId!==value.account.membershipId)throw Object.assign(new Error("Background account context changed."),{status:403});
    const current=()=>request===generation && isAuthScopeCurrent(scope);
    const saved=value;
    const result=await deliverFleetBackgroundSample(saved,sample,{readCurrent:()=>authority(saved.runId),consent:hasActiveConsentForThisDevice,permission,contextCurrent:current,operationId:Crypto.randomUUID,persist:async binding=>{if(!current())throw Object.assign(new Error("Background account context changed."),{status:403});value={...binding,enabled:true};await store(value);},post:input=>apiFetch(`/api/fleet/runs/${saved.runId}/location`,{method:"POST",body:JSON.stringify(input)})});
    emit("accepted","An OS-delivered driver-phone report was accepted. It is not truck telemetry or arrival proof.",result.recordedAt);
  }catch(error){
    await stopOS();const code=(error as {status?:number}).status;
    if(request!==generation || (code && code>=400 && code<500)){await SecureStore.deleteItemAsync(KEY);emit("stopped","Current Fleet duty, consent, permission or account was refused. Background sharing stopped.",null);}
    else{if(value)await store({...value,enabled:false});emit("unavailable","Background delivery is unverified. Sharing stopped; explicitly restart to retry the exact pending report.");}
  }
});}
if(!isExpoGo && !TaskManager.isTaskDefined(FLEET_BACKGROUND_TASK))TaskManager.defineTask(FLEET_BACKGROUND_TASK,async({data,error})=>{if(error){await stopFleetBackgroundLocation(false);return;}const locations=(data as {locations?:Location.LocationObject[]})?.locations;const last=locations?.at(-1);if(last)await handleFleetBackgroundSample({latitude:last.coords.latitude,longitude:last.coords.longitude,accuracy:last.coords.accuracy,timestamp:last.timestamp});});
let observedScope=captureAuthScope();
function authChanged(){if(!isAuthScopeCurrent(observedScope)){observedScope=captureAuthScope();void stopFleetBackgroundLocation(true).catch(()=>undefined);}}
subscribeToken(authChanged);subscribeUser(authChanged);
