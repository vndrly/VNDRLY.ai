import {createDurableFleetWorkJournal,openFleetBrowserStorage,type FleetWorkScope} from "@workspace/api-zod";
export const openWebFleetWorkStorage=openFleetBrowserStorage;
const bytes=(value:string)=>new TextEncoder().encode(value);
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,"0")).join("");
export async function openWebFleetWorkJournal(scope:FleetWorkScope,isCurrent:()=>boolean){
 const storage=await openWebFleetWorkStorage(`fleet:${JSON.stringify(scope)}`,isCurrent);
 return createDurableFleetWorkJournal({scope,storage,isCurrent,digest:async value=>hex(await crypto.subtle.digest("SHA-256",bytes(value)))});
}
export async function fleetBrowserStorageHealth(){
 const estimate=await navigator.storage?.estimate?.();const persisted=await navigator.storage?.persisted?.()??false;
 return {usage:estimate?.usage??null,quota:estimate?.quota??null,persisted,evictionProtection: persisted?"granted":"not_granted",availableBytes:estimate?.quota!==undefined?Math.max(0,estimate.quota-(estimate.usage??0)):null};
}
