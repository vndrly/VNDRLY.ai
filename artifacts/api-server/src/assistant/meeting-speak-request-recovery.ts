import { z } from "zod/v4";
import { MeetingSpeakRequestReceiptSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";

export const MeetingSpeakRequestArgumentsSchema = z
  .object({
    action: z.literal("request_to_speak"),
    occurrenceId: z.uuid(),
    payload: z.object({}).strict().optional(),
  })
  .strict();
/** Reads an exact saved request. Never re-posts, accepts consent or opens a microphone. */
export async function recoverMeetingSpeakRequestAction(
  action: {
    toolName: string;
    tokenHash: string;
    arguments: Record<string, unknown>;
  },
  session: SessionPayload,
  scopes: string[],
  request = callNaturalVoiceDomainApi,
) {
  if (
    action.toolName !== "moderate_work_hub_meeting" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  try {
    const args = MeetingSpeakRequestArgumentsSchema.parse(action.arguments),
      h = action.tokenHash.slice(0, 32);
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const { receipt } = z
      .object({ receipt: MeetingSpeakRequestReceiptSchema.nullable() })
      .strict()
      .parse(
        await request(
          `/work-hub/meetings/${args.occurrenceId}/request-to-speak/operations/${id}`,
          "GET",
          {},
          session,
        ),
      );
    return receipt &&
      receipt.operationId === id &&
      receipt.occurrenceId === args.occurrenceId &&
      receipt.actorUserId === session.userId &&
      receipt.actorMembershipId === (session.activeMembershipId ?? null) &&
      receipt.actorSessionVersion === session.sv &&
      receipt.ownerOrgType === (session.vendorId ? "vendor" : "partner") &&
      receipt.ownerOrgId === (session.vendorId ?? session.partnerId)
      ? receipt
      : null;
  } catch {
    return null;
  }
}
