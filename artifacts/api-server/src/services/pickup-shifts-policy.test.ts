import {expect,it} from "vitest";
import {pickupShiftEligible} from "./pickup-shifts-policy";
const start=new Date("2026-11-01T08:00:00Z"),end=new Date("2026-11-01T20:00:00Z");
const base={optedIn:true,startsAt:start,endsAt:end,available:true,allowed:true,overrideRequired:false,commitments:[]};
it("requires willingness and current eligibility",()=>{
 expect(pickupShiftEligible(base)).toBe(true);
 for(const change of [{optedIn:false},{available:false},{allowed:false},{overrideRequired:true}])expect(pickupShiftEligible({...base,...change})).toBe(false);
});
it("rejects overlaps and back-to-back watches before or after the proposed shift",()=>{
 for(const [a,b] of [["2026-11-01T00:00Z","2026-11-01T08:00Z"],["2026-11-01T20:00Z","2026-11-02T04:00Z"],["2026-11-01T09:00Z","2026-11-01T12:00Z"]]){
  expect(pickupShiftEligible({...base,commitments:[{start:new Date(a),end:new Date(b)}]})).toBe(false);
 }
 expect(pickupShiftEligible({...base,commitments:[{start:new Date("2026-10-31T16:00Z"),end:new Date("2026-11-01T00:00Z")}]})).toBe(true);
});
