import {afterEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>vi.fn());
vi.mock("./api",()=>({apiFetch:api}));
import {parseNotificationTarget,loadNotificationDestination} from "./notification-destination";
const id="20000000-0000-4000-8000-000000000001",other="30000000-0000-4000-8000-000000000001";
const run={id,fleetId:other,companyId:609,title:"Synthetic dispatch",driverUserId:1,vehicleAssetId:other,trailerAssetId:null,status:"dispatched",phase:null,version:1,stops:[{id:other,siteId:392,kind:"pickup",sequence:0}],siteIds:[392],loads:[],inspections:[],records:[],events:[],currentStopId:null,visitedStopIds:[],linkedTicketId:null,allowedActions:["acknowledge"]};
afterEach(()=>api.mockReset());
it("accepts only exact Fleet run notification paths without redirect or identity parameters",()=>{
 expect(parseNotificationTarget(`/fleet/runs/${id}`)).toEqual({kind:"fleet",id});
 for(const href of [`/fleet/runs/${id}?userId=2`,`/fleet/runs/${id}/extra`,`/fleet/runs/${id}#fragment`,`https://vndrly.ai/fleet/runs/${id}`,"/fleet/runs/invalid"]){expect(parseNotificationTarget(href)).toBeNull();}
});
it("reads current canonical run and refuses wrong record or revoked assignment",async()=>{
 api.mockResolvedValue(run);expect(await loadNotificationDestination({kind:"fleet",id})).toMatchObject({subjectId:id,title:"Synthetic dispatch",kind:"fleet",lines:["dispatched"]});expect(api).toHaveBeenCalledWith(`/api/fleet/runs/${id}`);
 api.mockResolvedValue({...run,id:other});await expect(loadNotificationDestination({kind:"fleet",id})).rejects.toThrow("notification.unavailable");
 api.mockRejectedValue(Object.assign(new Error("Revoked"),{status:403}));await expect(loadNotificationDestination({kind:"fleet",id})).rejects.toThrow("Revoked");
});
