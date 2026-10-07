import { z } from "zod/v4";
import {
  MeetingAssistantInvitationInputSchema,
  MeetingAssistantInvitationReceiptSchema,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { meetingInvitationFingerprint } from "../work-hub/meeting-assistant-invitation";
/** Saved canonical receipt only; never retries an effect or accepts consent. */
export async function recoverMeetingAssistantInvitationAction(
  action: {
    toolName: string;
    tokenHash: string;
    arguments: Record<string, unknown>;
  },
  session: SessionPayload,
  scopes: string[],
  request: typeof callNaturalVoiceDomainApi = callNaturalVoiceDomainApi,
) {
  if (
    action.toolName !== "manage_work_hub_meeting" ||
    action.arguments.action !== "set_assistant" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  try {
    const args = z
      .object({
        action: z.literal("set_assistant"),
        occurrenceId: z.uuid(),
        payload: MeetingAssistantInvitationInputSchema.omit({
          operationId: true,
        }),
      })
      .strict()
      .parse(action.arguments);
    const hex = action.tokenHash.slice(0, 32),
      operationId =
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-4" +
        hex.slice(13, 16) +
        "-8" +
        hex.slice(17, 20) +
        "-" +
        hex.slice(20, 32),
      command = { operationId, ...args.payload };
    const actor = {
      userId: session.userId!,
      actorMembershipId: session.activeMembershipId ?? null,
      actorSessionVersion: session.sv!,
      ownerOrgType: session.vendorId
        ? ("vendor" as const)
        : ("partner" as const),
      ownerOrgId: session.vendorId ?? session.partnerId!,
    };
    const response = z
        .object({ receipt: MeetingAssistantInvitationReceiptSchema.nullable() })
        .strict()
        .parse(
          await request(
            "/work-hub/meetings/" +
              args.occurrenceId +
              "/askv/operations/" +
              operationId +
              "?expectedVersion=" +
              args.payload.expectedVersion +
              "&invited=" +
              args.payload.invited,
            "GET",
            {},
            session,
          ),
        ),
      r = response.receipt;
    if (
      !r ||
      r.fingerprint !==
        meetingInvitationFingerprint(args.occurrenceId, actor, command) ||
      r.operationId !== operationId ||
      r.expectedVersion !== command.expectedVersion ||
      r.invited !== command.invited ||
      r.actorMembershipId !== actor.actorMembershipId ||
      r.actorSessionVersion !== actor.actorSessionVersion ||
      r.ownerOrgType !== actor.ownerOrgType ||
      r.ownerOrgId !== actor.ownerOrgId ||
      r.actorUserId !== session.userId ||
      r.occurrenceId !== args.occurrenceId ||
      r.version !== command.expectedVersion + 1
    )
      return null;
    return r;
  } catch {
    return null;
  }
}
