import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { transcribeMeetingRecording } from "@/lib/meeting-transcribe";
import { meetingStreamingAllowed, startMeetingStreamingCapture } from "@/lib/meeting-streaming";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";

/** Each attendee transcribes only their own microphone, so the API can attribute the speaker. */
export function useMeetingTranscription(
  occurrenceId: string,
  snapshot: MeetingSnapshot | undefined,
  joined: boolean,
  muted: boolean,
  stream: RefObject<MediaStream | null>,
) {
  const [transcriptionActive, setActive] = useState(false);
  const [transcriptionError, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stop = useRef<() => void>(() => undefined);
  const person = snapshot?.participants.find((participant) => participant.userId === snapshot.userId);
  const startedAt = Date.parse(snapshot?.occurrence.startedAt ?? "");
  const baseAllowed = Boolean(joined && !muted && snapshot?.transcription && snapshot.myConsent === "accepted"
    && snapshot.occurrence.askvInvitedAt && snapshot.occurrence.status === "live"
    && person?.present && !person.removedAt && Number.isFinite(startedAt));
  const streamingAllowed = Number.isFinite(startedAt) && meetingStreamingAllowed(snapshot, joined, muted);
  const nativeAllowed = baseAllowed && !streamingAllowed && snapshot?.nativeCaptureAvailable === true;
  const allowed = streamingAllowed || nativeAllowed;
  const latestAllowed = useRef(allowed); latestAllowed.current = allowed;
  const stopTranscription = useCallback(() => stop.current(), []);
  const retryTranscription = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!allowed || !stream.current) { setActive(false); return; }
    const input = stream.current;
    const controller = new AbortController();
    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    let streaming: { stop: () => Promise<void> } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let uploads = 0;
    const current = () => !cancelled && latestAllowed.current;
    const halt = () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      // Invalidate before stop: MediaRecorder emits its unfinished chunk when stopped.
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorder = null;
      void streaming?.stop(); streaming = null;
      setActive(false);
    };
    stop.current = halt;
    const fail = (cause: unknown) => {
      if (!current()) return;
      halt();
      setError(cause instanceof Error ? cause.message : "Meeting transcription stopped. Try again.");
    };
    const recordChunk = () => {
      if (!current()) return;
      try {
        if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot transcribe meeting audio. Use a browser with microphone recording support.");
        if (!input.getAudioTracks().some((track) => track.enabled && track.readyState === "live")) throw new Error("Your microphone is unavailable for transcription.");
        const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
        const media = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
        recorder = media;
        const startsAtMs = Math.max(0, Date.now() - startedAt);
        let endsAtMs = startsAtMs;
        media.ondataavailable = (event) => {
          if (!current() || !event.data.size) return;
          // Bound retained audio if the native service stalls instead of buffering a whole meeting.
          if (uploads >= 3) { fail(new Error("Meeting transcription is taking too long and has paused. Try again.")); return; }
          uploads += 1;
          void (async () => {
            try {
              const text = await transcribeMeetingRecording(occurrenceId, event.data, controller.signal);
              if (!current() || !text) return;
              await workHubRequest(`/meetings/${occurrenceId}/transcript`, {
                method: "POST", signal: controller.signal,
                body: JSON.stringify({ id: createWorkHubOperationId(), text, startsAtMs, endsAtMs }),
              });
            } catch (cause) { fail(cause); }
            finally { uploads -= 1; }
          })();
        };
        media.onerror = () => fail(new Error("Microphone recording stopped. Try transcription again."));
        media.onstop = () => { if (timer) clearTimeout(timer); if (recorder === media) recorder = null; if (current()) recordChunk(); };
        media.start();
        setActive(true);
        timer = setTimeout(() => {
          endsAtMs = Math.max(startsAtMs, Date.now() - startedAt);
          if (media.state === "recording") media.stop();
        // Leave margin below the server's decoded-duration ceiling if the
        // browser schedules this callback late while rendering or backgrounded.
        }, 15_000);
      } catch (cause) { fail(cause); }
    };
    const microphoneEnded = () => fail(new Error("Your microphone disconnected. Rejoin audio to continue transcription."));
    input.getAudioTracks().forEach((track) => track.addEventListener("ended", microphoneEnded));
    setError(null);
    if (streamingAllowed) {
      void startMeetingStreamingCapture({
        occurrenceId, input, startedAtMs: Math.max(0, Date.now() - startedAt), signal: controller.signal, onError: fail,
      }).then((capture) => {
        if (!current()) { void capture.stop(); return; }
        streaming = capture; setActive(true);
      }).catch(fail);
    } else recordChunk();
    return () => {
      halt();
      input.getAudioTracks().forEach((track) => track.removeEventListener("ended", microphoneEnded));
      if (stop.current === halt) stop.current = () => undefined;
    };
  }, [allowed, streamingAllowed, occurrenceId, startedAt, snapshot?.meeting.policyVersion, stream, attempt]);

  return { transcriptionActive: transcriptionActive && allowed, transcriptionError, stopTranscription, retryTranscription };
}
