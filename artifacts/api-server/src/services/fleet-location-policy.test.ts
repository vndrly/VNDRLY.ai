import {expect,it} from "vitest";
import {NativePolicySchema} from "./native-operations-policy";
it("requires explicit admin policy opt-in for driver location pause while preserving other settings",()=>{
 expect(NativePolicySchema.parse({}).allowDriverLocationPause).toBe(false);
 expect(NativePolicySchema.parse({allowDriverLocationPause:true,automaticArrival:true}).allowDriverLocationPause).toBe(true);
 expect(()=>NativePolicySchema.parse({allowDriverLocationPause:"true"})).toThrow();
});
