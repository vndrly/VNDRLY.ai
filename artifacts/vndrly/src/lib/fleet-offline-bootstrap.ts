import {z} from "zod/v4";
import {FleetRunSchema,type FleetOverview,type FleetResources} from "@workspace/api-zod";
import {openWebFleetWorkStorage} from "./fleet-work-journal-web";
type UserScope={userId:number;activeMembershipId:number|null;vendorId:number|null};
const owner=z.object({userId:z.number().int().positive(),membershipId:z.number().int().positive(),companyId:z.number().int().positive()}).strict(),activeKey="vndrly.fleet.offline.active";
let generation=0;
type Workspace={auth:Record<string,unknown>;overview:FleetOverview;resources:FleetResources;receivedAt:string};
const identity=(user:UserScope)=>JSON.stringify(owner.parse({userId:user.userId,membershipId:user.activeMembershipId,companyId:user.vendorId}));
function verify(key:string,value:Workspace){
 const account=owner.extend({sessionVersion:z.number().int().nonnegative()}).strict().parse(value.overview.accountScope),scope=owner.parse(JSON.parse(key));
 if(account.userId!==scope.userId||account.membershipId!==scope.membershipId||account.companyId!==scope.companyId||value.overview.companyId!==scope.companyId||value.auth.userId!==scope.userId||value.auth.activeMembershipId!==scope.membershipId||value.auth.vendorId!==scope.companyId)throw Error("Original Fleet workspace scope changed");
 z.iso.datetime().parse(value.receivedAt);for(const run of value.overview.runs){if(FleetRunSchema.parse(run).companyId!==scope.companyId)throw Error("Original Fleet workspace scope changed");}return value;
}
/** No credentials/tokens or source documents are stored. This is an encrypted
 * original-context bootstrap, never an authentication or permission grant. */
export async function saveWebFleetWorkspace(user:UserScope,value:{overview:FleetOverview;resources:FleetResources},isCurrent:()=>boolean){
 const key=identity(user),source=user as unknown as Record<string,unknown>,auth=Object.fromEntries(["userId","role","displayName","partnerId","vendorId","vendorPeopleId","vendorRole","managedSubcontractor","preferredLanguage","activeMembershipId","availableMemberships","requiresContextChoice","mustChangePassword"].filter(name=>source[name]!==undefined).map(name=>[name,source[name]])),saved=verify(key,{...value,auth,receivedAt:new Date().toISOString()}),storage=await openWebFleetWorkStorage(`fleet-workspace:${key}`,isCurrent);
 await storage.transaction(tx=>tx.set("workspace","current",JSON.stringify(saved)));
}
export async function readWebFleetWorkspace(user:UserScope,isCurrent:()=>boolean){
 const key=identity(user),storage=await openWebFleetWorkStorage(`fleet-workspace:${key}`,isCurrent),value=await storage.transaction(tx=>tx.get("workspace","current"));return value?verify(key,JSON.parse(value) as Workspace):null;
}
export function activateWebFleetOffline(user:UserScope){localStorage.setItem(activeKey,identity(user));generation++;}
export function deactivateWebFleetOffline(){generation++;try{localStorage.removeItem(activeKey);}catch{/* Retained originals remain owned by their existing account. */}}
export async function readWebFleetOfflineAuth(){
 const expected=generation;try{const key=localStorage.getItem(activeKey);if(!key)return null;const scope=owner.parse(JSON.parse(key)),value=await readWebFleetWorkspace({userId:scope.userId,activeMembershipId:scope.membershipId,vendorId:scope.companyId},()=>generation===expected&&localStorage.getItem(activeKey)===key);return value&&generation===expected?value.auth:null;}catch{return null;}
}
