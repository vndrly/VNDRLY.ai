import {it,expect,vi} from "vitest";
import * as cache from "./fleet-offline-bootstrap";
vi.mock("./fleet-work-journal-web",()=>{const rows=new Map<string,string>();return {openWebFleetWorkStorage:async(identity:string,current:()=>boolean)=>({transaction:async(work:any)=>{if(!current())throw Error("account changed");return work({get:async(k:string,id:string)=>rows.get(`${identity}:${k}:${id}`)??null,set:async(k:string,id:string,v:string)=>{rows.set(`${identity}:${k}:${id}`,v)}})}})};});
it("restores only explicitly provisioned original Fleet context and locks its bootstrap on sign-out without deleting originals",async()=>{
 const user={userId:7,activeMembershipId:9,vendorId:11,role:"vendor",displayName:"Synthetic worker"},overview={accountScope:{userId:7,membershipId:9,companyId:11,sessionVersion:2},companyId:11,runs:[],fleets:[],observations:[]},resources={drivers:[],equipment:[]};
 await cache.saveWebFleetWorkspace(user,{overview,resources} as any,()=>true);expect(await cache.readWebFleetOfflineAuth()).toBeNull();
 cache.activateWebFleetOffline(user);expect((await cache.readWebFleetOfflineAuth())?.userId).toBe(7);
 expect(await cache.readWebFleetWorkspace({...user,vendorId:12},()=>true)).toBeNull();
 cache.deactivateWebFleetOffline();expect(await cache.readWebFleetOfflineAuth()).toBeNull();expect((await cache.readWebFleetWorkspace(user,()=>true))?.overview.accountScope?.sessionVersion).toBe(2);
 await expect(cache.saveWebFleetWorkspace({...user,userId:8},{overview,resources} as any,()=>true)).rejects.toThrow("scope");
});
