import {expect,it} from "vitest";
import {liveMeetingFingerprint,verifyLiveMeetingReplay} from "./live-meeting-fingerprint";
const e={owner:{type:"vendor",id:12},context:{kind:"organization",id:12},expectedVersion:2,payloadVersion:1,payload:{decision:"admit"}};
it("binds retries to the exact room, actor, version and decision",()=>{
 const digest=liveMeetingFingerprint(7,"decide","room-a",e);
 expect(digest).not.toBe(liveMeetingFingerprint(7,"decide","room-b",e));
 expect(digest).not.toBe(liveMeetingFingerprint(8,"decide","room-a",e));
 expect(digest).not.toBe(liveMeetingFingerprint(7,"decide","room-a",{...e,payload:{decision:"decline"}}));
 expect(()=>verifyLiveMeetingReplay({resource:{commandFingerprint:digest}},digest)).not.toThrow();
 expect(()=>verifyLiveMeetingReplay({resource:{commandFingerprint:digest}},"0".repeat(64))).toThrow("match");
});
