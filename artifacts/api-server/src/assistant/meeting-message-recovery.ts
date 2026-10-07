import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";
import {
  MeetingMessageArgumentsSchema,
  MeetingMessageReceiptSchema,
} from "../work-hub/meeting-message";
/** Exact saved typed-message readback; never sends another message or accepts participation consent. */
export async function recoverMeetingMessageAction(
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
    action.toolName !== "send_work_hub_meeting_message" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  try {
    const args = MeetingMessageArgumentsSchema.parse(action.arguments),
      h = action.tokenHash.slice(0, 32),
      id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const result = z
        .object({ receipt: MeetingMessageReceiptSchema.nullable() })
        .strict()
        .parse(
          await request(
            `/work-hub/meetings/${args.occurrenceId}/chat/operations/${id}`,
            "GET",
            {},
            session,
          ),
        ),
      r = result.receipt;
    return r &&
      r.id === id &&
      r.occurrenceId === args.occurrenceId &&
      r.userId === session.userId &&
      r.body === args.body &&
      r.recipientUserId === (args.recipientUserId ?? null)
      ? r
      : null;
  } catch {
    return null;
  }
}
