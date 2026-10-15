import { MeetingStreamingClient } from "@workspace/api-client-react/meeting-streaming";

import { apiFetch } from "./api";

export function createMobileMeetingStreamingClient(
  occurrenceId: string,
  authorization?: () => Record<string, unknown> | null,
  callId?: string,
) {
  return new MeetingStreamingClient(occurrenceId, {
    authorization,
    transport: <T>(path: string, body: string, signal: AbortSignal) =>
      apiFetch<T>(
        callId
          ? path.replace(
              `/api/work-hub/meetings/${occurrenceId}`,
              `/api/work-hub/calls/${callId}`,
            )
          : path,
        {
          method: "POST",
          body,
          signal,
        },
      ),
  });
}
