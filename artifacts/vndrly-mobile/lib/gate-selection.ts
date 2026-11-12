import { useSyncExternalStore } from "react";
type User={id?:number;vendorId?:number|null;partnerId?:number|null}|null|undefined;
export type GateSelection={siteId:number;stationId:string};
const values=new Map<string,GateSelection>();const listeners=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export function nativeGateSelectionKey(user:User,membership?:number|null){return user?.id?[user.id,membership??'',user.vendorId??'',user.partnerId??''].join(':'):'';}
export function readNativeGateSelection(key:string){return values.get(key)??null;}
export function clearNativeGateSelections(){values.clear();listeners.forEach(fn=>fn());}
export function saveNativeGateSelection(key:string,value:GateSelection){if(!key||!Number.isSafeInteger(value.siteId)||value.siteId<1)return;const prior=values.get(key);if(prior?.siteId===value.siteId&&prior.stationId===value.stationId)return;values.set(key,value);listeners.forEach(fn=>fn());}
export function useGateSelection(user:User,membership?:number|null){const key=nativeGateSelectionKey(user,membership);const selection=useSyncExternalStore(subscribe,()=>readNativeGateSelection(key));return{selection,save:(siteId:number,stationId:string)=>saveNativeGateSelection(key,{siteId,stationId})};}
