import { MeetingStreamingClient } from "@workspace/api-client-react/meeting-streaming";

import { apiFetch } from "./api";

export function createMobileMeetingStreamingClient(occurrenceId: string, authorization?: () => Record<string, unknown> | null) {
  return new MeetingStreamingClient(occurrenceId, {
    authorization,
    transport: <T>(path: string, body: string, signal: AbortSignal) => apiFetch<T>(path, {
      method: "POST",
      body,
      signal,
    }),
  });
}
