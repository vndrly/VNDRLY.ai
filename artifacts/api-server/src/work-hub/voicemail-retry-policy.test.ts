import {expect,it} from "vitest";
import {voicemailRetryPlan} from "./voicemail-retry-policy";
it("bounds retries to three attempts with recoverable delays",()=>{
  expect(voicemailRetryPlan(1,0)).toEqual({state:"retry",nextAt:new Date(5000)});
  expect(voicemailRetryPlan(2,0)).toEqual({state:"retry",nextAt:new Date(30000)});
  expect(voicemailRetryPlan(3,0)).toEqual({state:"failed",nextAt:null});
});
