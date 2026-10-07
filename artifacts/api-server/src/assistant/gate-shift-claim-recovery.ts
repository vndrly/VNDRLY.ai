import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { GateShiftAssignmentReadbackSchema, gateShiftAssignmentFingerprintValues } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";

/** Exact saved self-claim only. Never submits or changes a shift. */
export async function recoverGateShiftClaimAction(
  action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> },
  session: SessionPayload, scopes: string[], request = callNaturalVoiceDomainApi,
) {
  if (action.toolName !== "manage_work_hub_shift" || action.arguments.action !== "claim"
    || !session.userId || !session.vendorId || !/^[a-f0-9]{64}$/.test(action.tokenHash)
    || !chatGptActionTools(session, scopes).some(tool => tool.name === action.toolName)) return null;
  try {
    const input = z.object({
      action: z.literal("claim"), shiftId: z.uuid(), expectedVersion: z.number().int().positive(),
      owner: z.object({ type: z.literal("vendor"), id: z.number().int().positive() }).strict().optional(),
      context: z.object({ kind: z.enum(["gate", "site", "organization"]), id: z.union([z.string(), z.number()]) }).strict().optional(),
      payload: z.object({}).strict().optional(),
    }).strict().parse(action.arguments);
    if (input.owner && input.owner.id !== session.vendorId) return null;
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const expected = createHash("sha256").update(JSON.stringify({ action: "claim", ...gateShiftAssignmentFingerprintValues(
      input.shiftId, session.userId, session.vendorId, { operationId, expectedVersion: input.expectedVersion, assigneeUserIds: [session.userId] },
    ) })).digest("hex");
    const { receipt } = GateShiftAssignmentReadbackSchema.parse(await request(`/work-hub/shifts/${input.shiftId}/claim/operations/${operationId}`, "GET", {}, session));
    if (!receipt || receipt.operationId !== operationId || receipt.actorUserId !== session.userId || receipt.shiftId !== input.shiftId
      || receipt.previousVersion !== input.expectedVersion || receipt.resultingVersion !== input.expectedVersion + 1
      || receipt.assigneeUserIds.length !== 1 || receipt.assigneeUserIds[0] !== session.userId || receipt.commandFingerprint !== expected) return null;
    return receipt;
  } catch { return null; }
}
