import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),access:vi.fn(),publish:vi.fn(),release:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:m.query,connect:async()=>({query:m.query,release:m.release})}}));
vi.mock("./gate-change-over",()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},changeOverTransaction:async(fn:any)=>fn({query:m.query}),requireChangeOverAccess:m.access}));
vi.mock("../lib/notification-events",()=>({publishNotificationCreated:m.publish}));
import {gateMapPinShareOptions,readSharedGateMapPin,shareGateMapPin} from "./gate-map-pin-sharing";
import {gateNotificationVisible} from "../lib/gate-notification-policy";
const session={userId:1,vendorId:54,sv:2,activeMembershipId:3,displayName:"Colleague"} as any;
const pin={id:"00000000-0000-4000-8000-000000000001",siteId:10,label:"Meeting point",latitude:32,longitude:-102};
const groupId="00000000-0000-4000-8000-000000000002",operationId="00000000-0000-4000-8000-000000000003";
beforeEach(()=>{
 vi.clearAllMocks();m.access.mockResolvedValue({});m.query.mockImplementation(async(sql:string,args:any[])=>{
   if(sql.startsWith("SELECT gate_map_pins"))return {rows:[{gate_map_pins:[pin]}]};
   if(sql.startsWith("SELECT DISTINCT"))return {rows:[{userId:1,name:"Admin"},{userId:2,name:"Gatekeeper"}]};
   if(sql.startsWith("SELECT g.id"))return {rows:[{id:groupId,name:"Day crew",userIds:[2,999]}]};
   if(sql.startsWith("INSERT INTO notifications"))return {rows:[{id:args[0],userId:args[0],type:"gate_map_pin_shared",title:args[1],body:args[2],link:args[3],createdAt:new Date()}]};
   return {rows:[]};
 });
});
it("loads only the active company's people/groups after checking access and sends nothing on open",async()=>{
 const result=await gateMapPinShareOptions(session,pin.id);
 expect(result.groups[0].userIds).toEqual([2]);expect(m.access).toHaveBeenCalledWith(expect.anything(),session,10);
 expect(m.query.mock.calls.find(([sql])=>sql.startsWith("SELECT DISTINCT"))?.[1]).toEqual([54]);
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);expect(m.publish).not.toHaveBeenCalled();
});
it.each(["all","group","individuals"])("notifies the selected %s audience with an exact pin link",async audience=>{
 const result=await shareGateMapPin(session,pin.id,{operationId,audience,...(audience==="group"?{groupId}:{}),userIds:audience==="individuals"?[2]:[]});
 expect(result.notifiedCount).toBe(audience==="all"?2:1);
 expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({link:`/gate/map?pinId=${pin.id}&siteId=10`,notifType:"gate_map_pin_shared",category:"gate_crew"}));
 expect(gateNotificationVisible({type:"gate_map_pin_shared"})).toBe(true);
 expect(m.query.mock.calls.filter(([sql])=>sql.startsWith("INSERT INTO notifications")).some(([,args])=>args[0]===999)).toBe(false);
});
it("reuses the durable receipt on a retry and rejects a changed audience",async()=>{
 const input={operationId,audience:"individuals",userIds:[2]};
 const receipt={operationId,command:JSON.stringify({pinId:pin.id,...input}),notifiedCount:1};
 const priorQuery=m.query.getMockImplementation()!;
 m.query.mockImplementation((sql:string,args:any[])=>sql.startsWith("SELECT result_json")?Promise.resolve({rows:[{result_json:receipt}]}):priorQuery(sql,args));
 expect((await shareGateMapPin(session,pin.id,input)).notifiedCount).toBe(1);expect(m.publish).not.toHaveBeenCalled();
 await expect(shareGateMapPin(session,pin.id,{...input,userIds:[1]})).rejects.toMatchObject({status:409});
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
});
it("rejects outside-company individuals/groups, removed pins, revoked access and public demo sends",async()=>{
 await expect(shareGateMapPin(session,pin.id,{operationId,audience:"individuals",userIds:[999]})).rejects.toMatchObject({status:403});
 await expect(shareGateMapPin(session,pin.id,{operationId,audience:"group",groupId:operationId})).rejects.toMatchObject({status:403});
 m.access.mockRejectedValueOnce(Error("Revoked"));await expect(shareGateMapPin(session,pin.id,{operationId,audience:"all"})).rejects.toThrow("Revoked");
 await expect(shareGateMapPin({...session,publicDemo:true},pin.id,{operationId,audience:"all"})).rejects.toMatchObject({status:403});
 m.query.mockResolvedValueOnce({rows:[{gate_map_pins:[{...pin,removedAt:new Date().toISOString()}]}]});
 await expect(readSharedGateMapPin(session,pin.id)).rejects.toMatchObject({status:404});
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);expect(m.publish).not.toHaveBeenCalled();
});
