import {expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({rows:[] as any[][]}));
vi.mock("@workspace/db",async()=>{const actual=await vi.importActual<any>("@workspace/db");return {...actual,db:{select:()=>{const rows=m.rows.shift()??[];const q:any={from:()=>q,innerJoin:()=>q,where:()=>q,limit:async()=>rows};return q;}}};});
import {liveMeetingPushAllowed} from "./live-meeting-notifications";
it("rechecks membership and refuses removed participants before sending saved content",async()=>{
 m.rows=[[{vendorId:12,status:"live"}],[]];expect(await liveMeetingPushAllowed(7,"room")).toBe(false);
 m.rows=[[{vendorId:12,status:"live"}],[{id:7}],[{removedAt:new Date()}]];expect(await liveMeetingPushAllowed(7,"room")).toBe(false);
});
it("honors current preferences instead of preferences saved when queued",async()=>{
 m.rows=[[{vendorId:12,status:"live"}],[{id:7}],[],[{pushEnabled:false}]];expect(await liveMeetingPushAllowed(7,"room")).toBe(false);
 m.rows=[[{vendorId:12,status:"live"}],[{id:7}],[],[{pushEnabled:true,workHubMeetingsEnabled:true}]];expect(await liveMeetingPushAllowed(7,"room")).toBe(true);
});
