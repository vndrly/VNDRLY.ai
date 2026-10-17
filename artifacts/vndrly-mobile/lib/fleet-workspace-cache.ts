import {z} from "zod/v4";
import {FleetRunSchema,type FleetOverview,type FleetResources} from "@workspace/api-zod";
const actorSchema=z.object({userId:z.number().int().positive(),companyId:z.number().int().positive(),membershipId:z.number().int().positive()}).strict();
type Actor=z.infer<typeof actorSchema>;
type Cached={overview:FleetOverview;resources:FleetResources;receivedAt:string};
function verify(actor:Actor,value:Cached){
 const account=actorSchema.extend({sessionVersion:z.number().int().nonnegative()}).strict().parse(value.overview.accountScope);
 if(account.userId!==actor.userId||account.companyId!==actor.companyId||account.membershipId!==actor.membershipId||value.overview.companyId!==actor.companyId)throw Error("Original workspace scope changed");
 z.iso.datetime().parse(value.receivedAt);for(const run of value.overview.runs){const saved=FleetRunSchema.parse(run);if(saved.companyId!==actor.companyId)throw Error("Original workspace scope changed");}
 return value;
}
/** Cached context permits retaining reports, never new server authority. It is
 * encrypted under the original worker/company/membership and is not rebound. */
export async function saveFleetWorkspaceCache(raw:Actor,value:Omit<Cached,"receivedAt">,isCurrent:()=>boolean){
 const {openNativeFleetWorkStorage}=await import("./fleet-work-journal-native");
 const actor=actorSchema.parse(raw),saved=verify(actor,{...value,receivedAt:new Date().toISOString()}),{storage}=await openNativeFleetWorkStorage(`fleet-workspace:${JSON.stringify(actor)}`,isCurrent);
 await storage.transaction(tx=>tx.set("workspace","current",JSON.stringify(saved)));
}
export async function readFleetWorkspaceCache(raw:Actor,isCurrent:()=>boolean){
 const {openNativeFleetWorkStorage}=await import("./fleet-work-journal-native");
 const actor=actorSchema.parse(raw),{storage}=await openNativeFleetWorkStorage(`fleet-workspace:${JSON.stringify(actor)}`,isCurrent),value=await storage.transaction(tx=>tx.get("workspace","current"));
 return value?verify(actor,JSON.parse(value) as Cached):null;
}
