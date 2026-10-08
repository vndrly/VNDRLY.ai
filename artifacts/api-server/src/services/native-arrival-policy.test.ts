import {it,expect} from "vitest";
import {requireMeasuredArrival} from "./native-arrival-policy";
const now=Date.parse("2026-10-08T02:00:00Z"),site={latitude:35,longitude:-97,siteRadiusMeters:100},sample={latitude:35,longitude:-97,accuracy:10,capturedAt:new Date(now).toISOString()};
it("allows a recent accurate measurement inside the canonical site",()=>expect(()=>requireMeasuredArrival(sample,site,now)).not.toThrow());
it("requires review for uncertain or outside positions",()=>{expect(()=>requireMeasuredArrival({...sample,accuracy:101},site,now)).toThrow("native.arrival_confirmation_required");expect(()=>requireMeasuredArrival({...sample,latitude:36},site,now)).toThrow("native.arrival_confirmation_required");});
it("rejects stale or future samples without starting a work clock",()=>{expect(()=>requireMeasuredArrival({...sample,capturedAt:new Date(now-61000).toISOString()},site,now)).toThrow("native.arrival_location_stale");expect(()=>requireMeasuredArrival({...sample,capturedAt:new Date(now+6000).toISOString()},site,now)).toThrow("native.arrival_location_stale");});
it("rejects nonfinite radius and malformed measured coordinates",()=>{
 for(const radius of [NaN,Infinity])expect(()=>requireMeasuredArrival(sample,{...site,siteRadiusMeters:radius},now)).toThrow();
 for(const latitude of [NaN,Infinity,91])expect(()=>requireMeasuredArrival({...sample,latitude},site,now)).toThrow();
});
