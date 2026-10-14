import { describe, expect, it } from "vitest";
import { callTranscriptDecision } from "./call-transcript-policy";
describe("internal vendor transcription policy", () => {
  const base = { vendorId: 7, ownerVendorId: 7, actorUserId: 1, callerUserId: 1, recipientUserId: 2, memberIds: [1,2], admin: false, active: true, policy: { enabled: true, version: 1, verifiedByUserId: 3, effectiveAt: "2026-01-01T00:00:00Z" } };
  it("allows current internal participants without per-call approval", () => expect(callTranscriptDecision(base,"capture")).toBe(true));
  it("refuses external contacts, context switches and revoked membership", () => {
    expect(callTranscriptDecision({...base,memberIds:[1]},"capture")).toBe(false);
    expect(callTranscriptDecision({...base,vendorId:8},"read")).toBe(false);
    expect(callTranscriptDecision({...base,memberIds:[2]},"read")).toBe(false);
  });
  it("allows authorized vendor admin reads but not admin capture of others", () => {
    expect(callTranscriptDecision({...base,actorUserId:3,admin:true,memberIds:[1,2,3]},"read")).toBe(true);
    expect(callTranscriptDecision({...base,actorUserId:3,admin:true,memberIds:[1,2,3]},"capture")).toBe(false);
  });
  it("requires verified effective policy for capture but keeps ended records readable", () => {
    expect(callTranscriptDecision({...base,policy:{...base.policy,enabled:false}},"capture")).toBe(false);
    expect(callTranscriptDecision({...base,active:false},"capture")).toBe(false);
    expect(callTranscriptDecision({...base,active:false},"read")).toBe(true);
  });
});
