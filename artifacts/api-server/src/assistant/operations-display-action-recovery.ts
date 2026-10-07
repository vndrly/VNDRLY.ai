import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { displayActionRequest } from "./operations-display-action-adapter";

const receiptSchema = z.object({
  operationId: z.uuid(), displayId: z.uuid(), action: z.enum(["route", "join_room", "revoke"]),
  actorUserId: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("applied"), recordedAt: z.iso.datetime(), physicalDisplayVerified: z.literal(false),
  cameraStarted: z.literal(false), microphoneStarted: z.literal(false),
}).strict();

/** Read an exact canonical receipt only; never execute or rebase an uncertain command. */
export async function recoverOperationsDisplayAction(
  action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> },
  session: SessionPayload,
  scopes: string[],
  request: typeof callNaturalVoiceDomainApi = callNaturalVoiceDomainApi,
) {
  if (action.toolName !== "confirm_operations_displays_action" || !/^[a-f0-9]{64}$/.test(action.tokenHash)
    || !chatGptActionTools(session, scopes).some(tool => tool.name === action.toolName)) return null;
  try {
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const command = displayActionRequest({ ...action.arguments, operationId }, true);
    const result = receiptSchema.safeParse(await request(command.path, command.method, command.body, session));
    if (!result.success || result.data.operationId !== operationId || result.data.displayId !== command.body.displayId
      || result.data.action !== command.body.action || result.data.actorUserId !== session.userId) return null;
    return result.data;
  } catch {
    // Absence, authority changes and transport uncertainty remain unresolved.
    return null;
  }
}
