import {it,expect,vi} from "vitest";
import * as cache from "./fleet-workspace-cache";
vi.mock("./fleet-work-journal-native",()=>{const rows=new Map<string,string>();return {openNativeFleetWorkStorage:async(identity:string,current:()=>boolean)=>({storage:{transaction:async(work:any)=>{if(!current())throw Error("account changed");return work({get:async(k:string,id:string)=>rows.get(`${identity}:${k}:${id}`)??null,set:async(k:string,id:string,v:string)=>{rows.set(`${identity}:${k}:${id}`,v)}})}}})};});
it("restores only the original authenticated Fleet workspace after a network loss, without rebinding it to another worker or membership",async()=>{
 const actor={userId:7,companyId:11,membershipId:9},account={...actor,sessionVersion:3},overview={accountScope:account,companyId:11,runs:[],fleets:[],observations:[]},resources={drivers:[],equipment:[]};
 await cache.saveFleetWorkspaceCache(actor,{overview,resources} as any,()=>true);expect((await cache.readFleetWorkspaceCache(actor,()=>true))?.overview.accountScope).toEqual(account);
 expect(await cache.readFleetWorkspaceCache({...actor,membershipId:10},()=>true)).toBeNull();await expect(cache.saveFleetWorkspaceCache({...actor,userId:8},{overview,resources} as any,()=>true)).rejects.toThrow("scope");await expect(cache.readFleetWorkspaceCache(actor,()=>false)).rejects.toThrow("changed");
});
