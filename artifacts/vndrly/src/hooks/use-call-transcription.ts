import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { startPcmStreamingCapture } from "@/lib/meeting-streaming";
import { workHubRequest } from "@/lib/work-hub-client";

type AudioAuthorization = { deviceId: string; connectionId: string; token: string; generation: number };
export type CallTranscriptionPolicy = { enabled: boolean; policyVersion: number };

/** Send only this participant's microphone through the existing local Whisper endpoint. */
export function useCallTranscription(
  callId: string | null | undefined,
  policy: CallTranscriptionPolicy | undefined,
  capturing: boolean,
  stream: RefObject<MediaStream | null>,
  getAuthorization: () => AudioAuthorization | null,
) {
  const enabled = policy?.enabled === true;
  const [error, setError] = useState<string | null>(null);
  const authorization = useRef(getAuthorization);
  authorization.current = getAuthorization;
  const stop = useRef<() => void>(() => undefined);
  const previousClose = useRef(Promise.resolve());
  const stopCallTranscription = useCallback(() => stop.current(), []);

  useEffect(() => {
    if (!callId || !capturing || !enabled || !stream.current) return;
    const input = stream.current;
    const controller = new AbortController();
    const path = `/calls/${callId}/transcription-stream`;
    let session: { id: string; deviceId: string } | undefined;
    let processing = Promise.resolve();
    let closing: Promise<void> | undefined;
    const close = () => {
      if (closing) return closing;
      if (!session) return Promise.resolve();
      const { id, deviceId } = session;
      session = undefined;
      closing = workHubRequest(`${path}/${id}/close`, {
        method: "POST", body: JSON.stringify({ deviceId, reason: "pause" }),
      }).then(() => undefined, () => undefined);
      return closing;
    };
    const halt = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      previousClose.current = processing.then(close);
    };
    stop.current = halt;
    const fail = () => {
      if (controller.signal.aborted) return;
      setError("Captions paused on this device.");
      halt();
    };
    setError(null);
    processing = previousClose.current.then(async () => {
      if (controller.signal.aborted) return;
      await startPcmStreamingCapture({ input, signal: controller.signal, onError: fail }, {
        open: async (signal) => {
          const auth = authorization.current();
          if (!auth) throw new Error("Call audio is not active on this device.");
          const result = await workHubRequest<{ sessionId: string; frameDurationMs: number }>(path, {
            method: "POST", body: JSON.stringify(auth),
          });
          session = { id: result.sessionId, deviceId: auth.deviceId };
          if (signal.aborted) await close();
          return result;
        },
        send: async (sequence, frame, signal) => {
          const auth = authorization.current();
          if (!session || !auth) throw new Error("Call audio is not active on this device.");
          await workHubRequest(`${path}/${session.id}/frame`, {
            method: "POST", signal, body: JSON.stringify({
              ...auth, sequence, pcmBase64: btoa(String.fromCharCode(...frame)),
            }),
          });
        },
        close,
      });
    }).catch(fail);
    return () => {
      halt();
      if (stop.current === halt) stop.current = () => undefined;
    };
  }, [callId, enabled, policy?.policyVersion, capturing, stream]);

  return {
    callCaptionsError: capturing ? error : null,
    stopCallTranscription,
  };
}
