import type { SessionPayload } from "../lib/session";
import { WorkHubAwayReceiptSchema } from "@workspace/api-zod";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { awayResponderAvailable, awayResponderRequest } from "./away-responder-tools";
import { awayResponderCommandFingerprint } from "../services/work-hub-away-responder";

/** Read an exact saved setting receipt. Never configure or send a reply during recovery. */
export async function recoverAwayResponderAction(
  action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> },
  session: SessionPayload,
  scopes: string[],
  request: typeof callNaturalVoiceDomainApi = callNaturalVoiceDomainApi,
) {
  if (action.toolName !== "manage_work_hub_away_responder" || !/^[a-f0-9]{64}$/.test(action.tokenHash) || !awayResponderAvailable(session, scopes)) return null;
  try {
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const command = awayResponderRequest(action.arguments, operationId).body;
    const actor = { userId: session.userId!, membershipId: session.activeMembershipId!, sessionVersion: session.sv!, owner: session.role === "partner" ? { type: "partner" as const, id: session.partnerId! } : { type: "vendor" as const, id: session.vendorId! } };
    const result = await request(`/work-hub/away-responder/operations/${operationId}`, "GET", {}, session);
    if (!result || typeof result !== "object" || Array.isArray(result) || !("receipt" in result)) return null;
    const parsed = WorkHubAwayReceiptSchema.safeParse(result.receipt);
    if (!parsed.success) return null;
    const receipt = parsed.data;
    if (receipt.operationId !== operationId || receipt.fingerprint !== awayResponderCommandFingerprint(command, actor) || receipt.rule.userId !== actor.userId || receipt.rule.owner.type !== actor.owner.type || receipt.rule.owner.id !== actor.owner.id || receipt.rule.version !== command.expectedVersion + 1) return null;
    if (command.action === "configure") {
      if (receipt.status !== "configured" || receipt.rule.status !== "active" || receipt.rule.startsAt !== command.startsAt || receipt.rule.endsAt !== command.endsAt || receipt.rule.replyText !== command.replyText || JSON.stringify(receipt.rule.channelIds) !== JSON.stringify(command.channelIds)) return null;
    } else if (receipt.rule.id !== command.ruleId || receipt.status !== (command.action === "pause" ? "paused" : "revoked") || receipt.rule.status !== receipt.status) return null;
    return result;
  } catch { return null; }
}
