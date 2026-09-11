import { MeetingStreamingClient } from "@workspace/api-client-react/meeting-streaming";

import { apiFetch } from "./api";

export function createMobileMeetingStreamingClient(occurrenceId: string) {
  return new MeetingStreamingClient(occurrenceId, {
    transport: <T>(path: string, body: string, signal: AbortSignal) => apiFetch<T>(path, {
      method: "POST",
      body,
      signal,
    }),
  });
}
