import {expect,it} from "vitest";
import {fleetCommercialCompanyIds,isFleetCommercialWorkEnabled} from "./fleet-commercial-activation";
it("enables only an explicitly listed company while the general commercial release stays off",()=>{
 const env={FLEET_COMMERCIAL_WORK_V2:"0",FLEET_COMMERCIAL_WORK_V2_VENDOR_IDS:"7, 19"};
 expect(isFleetCommercialWorkEnabled(7,env)).toBe(true);expect(isFleetCommercialWorkEnabled(19,env)).toBe(true);
 expect(isFleetCommercialWorkEnabled(8,env)).toBe(false);expect(isFleetCommercialWorkEnabled(undefined,env)).toBe(false);
 expect(isFleetCommercialWorkEnabled(7,{})).toBe(false);expect(isFleetCommercialWorkEnabled(8,{FLEET_COMMERCIAL_WORK_V2:"1"})).toBe(true);
});
it("rejects malformed or unsafe company identities without prefix matches",()=>{
 const env={FLEET_COMMERCIAL_WORK_V2_VENDOR_IDS:"7junk,-2,0,Infinity,9.5,9007199254740993,19"};
 expect(fleetCommercialCompanyIds(env)).toEqual([19]);expect(isFleetCommercialWorkEnabled(7,env)).toBe(false);
 expect(isFleetCommercialWorkEnabled(Number.NaN,env)).toBe(false);
});
