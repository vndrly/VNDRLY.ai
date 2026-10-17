import {openFleetBrowserStorage} from "@workspace/api-zod";
export const openWebFleetWorkStorage=openFleetBrowserStorage;
export {openFleetBrowserJournal as openWebFleetWorkJournal} from "@workspace/api-zod";
export async function fleetBrowserStorageHealth(){
 const estimate=await navigator.storage?.estimate?.();const persisted=await navigator.storage?.persisted?.()??false;
 return {usage:estimate?.usage??null,quota:estimate?.quota??null,persisted,evictionProtection: persisted?"granted":"not_granted",availableBytes:estimate?.quota!==undefined?Math.max(0,estimate.quota-(estimate.usage??0)):null};
}
