import {expect,it} from "vitest";
import {callTranscriptPublicationAllowed} from "./call-transcript-publication";
const base={deviceValid:true,participantActive:true,leaseValid:true,leaseReplaced:false,present:true,muted:false,callActive:true,endedAt:null,closedAt:null,lastFrameAt:1000};
it("refuses publication after device lease transfer, revocation or mute",()=>{
  expect(callTranscriptPublicationAllowed(base,2000)).toBe(true);
  expect(callTranscriptPublicationAllowed({...base,leaseReplaced:true},2000)).toBe(false);
  expect(callTranscriptPublicationAllowed({...base,deviceValid:false},2000)).toBe(false);
  expect(callTranscriptPublicationAllowed({...base,muted:true},2000)).toBe(false);
});
it("permits only a bounded previously-authorized normal hangup tail",()=>{
  const tail={...base,callActive:false,leaseValid:false,present:false,endedAt:1500,closedAt:1400};
  expect(callTranscriptPublicationAllowed(tail,2000)).toBe(true);
  expect(callTranscriptPublicationAllowed({...tail,closedAt:null},2000)).toBe(false);
  expect(callTranscriptPublicationAllowed({...tail,leaseReplaced:true},2000)).toBe(false);
  expect(callTranscriptPublicationAllowed(tail,40000)).toBe(false);
});
