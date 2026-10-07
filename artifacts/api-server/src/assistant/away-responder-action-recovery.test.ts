import { describe, expect, it, vi } from "vitest";
import { recoverAwayResponderAction } from "./away-responder-action-recovery";
import { awayResponderCommandFingerprint } from "../services/work-hub-away-responder";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";

const session = { userId: 41, role: "vendor", vendorId: 12, activeMembershipId: 5, sv: 2 } as SessionPayload;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const args = { action: "configure", expectedVersion: 0, startsAt: "2026-10-07T12:00:00.000Z", endsAt: "2026-10-07T14:00:00.000Z", replyText: "I will reply when I return.", channelIds: ["11111111-1111-4111-8111-111111111111"] };
const action = { toolName: "manage_work_hub_away_responder", tokenHash: "a".repeat(64), arguments: args };
function saved() {
  const actor = { userId: 41, membershipId: 5, sessionVersion: 2, owner: { type: "vendor" as const, id: 12 } };
  return { receipt: { operationId, fingerprint: awayResponderCommandFingerprint({ ...args, operationId }, actor), status: "configured", rule: { id: operationId, version: 1, userId: 41, owner: actor.owner, status: "active", startsAt: args.startsAt, endsAt: args.endsAt, replyText: args.replyText, channelIds: args.channelIds, configuredAt: args.startsAt, updatedAt: args.startsAt }, savedAt: args.startsAt, providerDeliveryVerified: false } };
}
describe("exact away-setting recovery", () => {
  it.each(["pause", "revoke"] as const)("recovers an exact %s receipt without repeating it", async control => {
    const command = { action: control, expectedVersion: 1, ruleId: operationId };
    const result = saved();
    result.receipt.status = control === "pause" ? "paused" : "revoked";
    result.receipt.rule.status = result.receipt.status;
    result.receipt.rule.version = 2;
    result.receipt.fingerprint = awayResponderCommandFingerprint({ ...command, operationId }, { userId: 41, membershipId: 5, sessionVersion: 2, owner: { type: "vendor", id: 12 } });
    const request = vi.fn().mockResolvedValue(result);
    expect(await recoverAwayResponderAction({ ...action, arguments: command }, session, ["work_hub:write"], request as typeof callNaturalVoiceDomainApi)).toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith(`/work-hub/away-responder/operations/${operationId}`, "GET", {}, session);
  });
  it("reads a bound receipt once without repeating the command", async () => {
    const result = saved(), request = vi.fn().mockResolvedValue(result);
    expect(await recoverAwayResponderAction(action, session, ["work_hub:write"], request as typeof callNaturalVoiceDomainApi)).toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith(`/work-hub/away-responder/operations/${operationId}`, "GET", {}, session);
  });
  it.each(["actor", "version", "text", "fingerprint", "status"])("refuses an unrelated %s receipt without writing", async kind => {
    const result = saved();
    if (kind === "actor") result.receipt.rule.userId = 42;
    if (kind === "version") result.receipt.rule.version = 2;
    if (kind === "text") result.receipt.rule.replyText = "Different reply";
    if (kind === "fingerprint") result.receipt.fingerprint = "b".repeat(64);
    if (kind === "status") result.receipt.status = "paused";
    const request = vi.fn().mockResolvedValue(result);
    expect(await recoverAwayResponderAction(action, session, ["work_hub:write"], request as typeof callNaturalVoiceDomainApi)).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });
  it("requires current write scope and never recovers a missing result by resending", async () => {
    const request = vi.fn().mockResolvedValue({ receipt: null });
    expect(await recoverAwayResponderAction(action, session, [], request as typeof callNaturalVoiceDomainApi)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(await recoverAwayResponderAction(action, session, ["work_hub:write"], request as typeof callNaturalVoiceDomainApi)).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });
});
