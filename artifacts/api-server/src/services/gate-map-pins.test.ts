import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({query:vi.fn(),access:vi.fn()}));
vi.mock("./gate-change-over",()=>({ChangeOverError:class extends Error{constructor(public status:number,public code:string,message:string){super(message);}},changeOverTransaction:async(fn:any)=>fn({query:mocks.query}),requireChangeOverAccess:mocks.access}));
import { saveGateMapPin, setGateMapPinRemoved } from "./gate-map-pins";
const session={userId:1,vendorId:54,sv:2} as any;
const input={id:"00000000-0000-4000-8000-000000000001",siteId:10,label:"Meet here",notes:"West road",latitude:32,longitude:-102};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({});mocks.query.mockResolvedValue({rows:[{gate_map_pins:[]}]});});
it("checks current site access and saves only within the active company under a row lock",async()=>{
 const result=await saveGateMapPin(session,input);
 expect(mocks.access).toHaveBeenCalledWith(expect.anything(),session,10);
 expect(mocks.query.mock.calls[0]).toEqual(["SELECT gate_map_pins FROM vendors WHERE id=$1 FOR UPDATE",[54]]);
 expect(result.pin).toMatchObject({...input,createdById:1});
 expect(mocks.query.mock.calls[1][1][0]).toBe(54);
});
it("retries the same pin without duplicating it and rejects changed retry details",async()=>{
 mocks.query.mockResolvedValue({rows:[{gate_map_pins:[{...input,createdById:1,createdAt:"2026-10-30T15:00:00Z"}]}]});
 await saveGateMapPin(session,input);expect(mocks.query).toHaveBeenCalledTimes(1);
 await expect(saveGateMapPin(session,{...input,label:"Different"})).rejects.toMatchObject({status:409});
});
it("rejects unauthorized site access, public previews and invalid coordinates before mutation",async()=>{
 mocks.access.mockRejectedValueOnce(new Error("forbidden"));
 await expect(saveGateMapPin(session,input)).rejects.toThrow("forbidden");expect(mocks.query).not.toHaveBeenCalled();
 await expect(saveGateMapPin({...session,publicDemo:true},input)).rejects.toMatchObject({status:403});
 await expect(saveGateMapPin(session,{...input,latitude:91})).rejects.toThrow();expect(mocks.query).not.toHaveBeenCalled();
});
it("removes a company pin without deleting its record and permits Undo",async()=>{
 const pin={...input,createdById:1,createdAt:"2026-10-30T15:00:00Z"};
 mocks.query.mockResolvedValue({rows:[{gate_map_pins:[pin]}]});
 const removed=await setGateMapPinRemoved(session,input.id,true);
 expect(removed.pin.removedAt).toBeTruthy();expect(removed.pin.removedById).toBe(1);
 expect(mocks.access).toHaveBeenCalledWith(expect.anything(),session,input.siteId);
 expect(JSON.parse(mocks.query.mock.calls[1][1][1])).toHaveLength(1);
 const restored=await setGateMapPinRemoved(session,input.id,false);
 expect(restored.pin.removedAt).toBeNull();expect(restored.pin.label).toBe(input.label);
});
it("cannot remove another company's pin or a pin at an inaccessible site",async()=>{
 mocks.query.mockResolvedValueOnce({rows:[{gate_map_pins:[]}]});
 await expect(setGateMapPinRemoved(session,input.id,true)).rejects.toMatchObject({status:404});
 expect(mocks.query).toHaveBeenCalledTimes(1);
 mocks.query.mockResolvedValue({rows:[{gate_map_pins:[input]}]});mocks.access.mockRejectedValueOnce(Error("No site access"));
 await expect(setGateMapPinRemoved(session,input.id,true)).rejects.toThrow("No site access");
 expect(mocks.query.mock.calls.filter(([sql])=>sql.startsWith("UPDATE"))).toHaveLength(0);
});
