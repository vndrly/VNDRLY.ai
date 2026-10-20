import{beforeEach,expect,it,vi}from"vitest";
const m=vi.hoisted(()=>({user:{id:1,activeMembershipId:7}as any,generation:1,store:new Map<string,string>()}));
vi.mock("./auth",()=>({getUser:async()=>m.user,captureAuthScope:()=>({generation:m.generation}),isAuthScopeCurrent:(s:any)=>s.generation===m.generation}));
vi.mock("expo-secure-store",()=>({getItemAsync:async(k:string)=>m.store.get(k)??null,setItemAsync:async(k:string,v:string)=>{m.store.set(k,v);}}));
beforeEach(()=>{vi.stubGlobal("window",undefined);vi.resetModules();m.store.clear();m.store.set("vndrly.deviceId","11111111-1111-4111-8111-111111111111");m.user={id:1,activeMembershipId:7};m.generation=1;});
it("adopts a work-phone alias only for the signed-in account, preserving the installation identity",async()=>{
 const d=await import("./deviceId");const original=await d.getDeviceId();await d.adoptAccountDeviceId("22222222-2222-4222-8222-222222222222",1,7);expect(await d.getDeviceId()).toBe("22222222-2222-4222-8222-222222222222");expect(m.store.get("vndrly.deviceId")).toBe(original);
 m.user={id:2,activeMembershipId:8};m.generation++;expect(await d.getDeviceId()).toBe(original);
 m.user={id:1,activeMembershipId:7};m.generation++;vi.resetModules();expect(await(await import("./deviceId")).getDeviceId()).toBe("22222222-2222-4222-8222-222222222222");
});
it("refuses to apply a different account's enrollment",async()=>{
 const d=await import("./deviceId");await expect(d.adoptAccountDeviceId("22222222-2222-4222-8222-222222222222",2,8)).rejects.toThrow();expect(await d.getDeviceId()).toBe("11111111-1111-4111-8111-111111111111");
});
