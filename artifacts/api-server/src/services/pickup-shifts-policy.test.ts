import {expect,it} from "vitest";
import {pickupShiftEligible} from "./pickup-shifts-policy";
const start=new Date("2026-11-01T08:00:00Z"),end=new Date("2026-11-01T20:00:00Z");
const base={optedIn:true,startsAt:start,endsAt:end,available:true,allowed:true,overrideRequired:false,commitments:[]};
it("uses willingness alone for contact priority",()=>{
 expect(pickupShiftEligible(base)).toBe(true);
 expect(pickupShiftEligible({...base,optedIn:false})).toBe(false);
 for(const change of [{available:false},{allowed:false},{overrideRequired:true}])expect(pickupShiftEligible({...base,...change})).toBe(true);
});
it("does not cancel willingness for overlaps or back-to-back watches",()=>{
 for(const [a,b] of [["2026-11-01T00:00Z","2026-11-01T08:00Z"],["2026-11-01T20:00Z","2026-11-02T04:00Z"],["2026-11-01T09:00Z","2026-11-01T12:00Z"]]){
  const person={...base,commitments:[{start:new Date(a),end:new Date(b)}]};
  expect(pickupShiftEligible(person)).toBe(true);
 }
});
