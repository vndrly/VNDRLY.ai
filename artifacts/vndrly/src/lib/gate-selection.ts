import { useSyncExternalStore } from "react";
type GateUser = { userId?: number; activeMembershipId?: number | string | null; vendorId?: number | null; partnerId?: number | null } | null | undefined;
export type GateSelection = {siteId:string;stationId:string};
const selections=new Map<string,GateSelection>();
const listeners=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export function gateSelectionKey(user:GateUser){return user?.userId ? [user.userId,user.activeMembershipId??'',user.vendorId??'',user.partnerId??''].join(':') : undefined;}
export function readGateSelection(user:GateUser):GateSelection|null {const key=gateSelectionKey(user);return key?selections.get(key)??null:null;}
export function saveGateSelection(user:GateUser,siteId:number,stationId:string){
 const key=gateSelectionKey(user);if(!key||!Number.isSafeInteger(siteId)||siteId<1)return;
 const prior=selections.get(key);if(prior?.siteId===String(siteId)&&prior.stationId===stationId)return;
 selections.set(key,{siteId:String(siteId),stationId});listeners.forEach(fn=>fn());
}
/** Browsing is intentionally memory-only: a reload resolves the operating gate again. */
export function clearGateSelections(){selections.clear();listeners.forEach(fn=>fn());}
export function useGateSelection(user:GateUser){return useSyncExternalStore(subscribe,()=>readGateSelection(user));}
