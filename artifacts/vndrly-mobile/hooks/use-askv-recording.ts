import { useCallback, useEffect, useRef, useState } from "react";
import { createPttRecorder, type PttRecorder } from "@/lib/ptt";
import { deleteAskVRecording, transcribeAskVRecording } from "@/lib/askv-transcribe";
import { subscribeAskVAppState } from "@/lib/askv-audio-session";

/** Explicit hold/release fallback. Late permission/transcription cannot revive a cancelled turn. */
export function useAskVRecording(options: {
  enabled: boolean;
  beforeStart(): Promise<void>;
  onTranscript(text: string): void | Promise<void>;
  onError(error: unknown): void;
}) {
  const latest = useRef(options); latest.current = options;
  const mounted = useRef(true);
  const generation = useRef(0);
  const phase = useRef<"idle" | "starting" | "recording" | "transcribing">("idle");
  const recorderRef = useRef<PttRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const cancel = useCallback(() => {
    generation.current += 1; phase.current = "idle";
    abortRef.current?.abort(); abortRef.current = null;
    const recorder = recorderRef.current; recorderRef.current = null;
    void recorder?.dispose().catch(() => undefined);
    if (mounted.current) { setRecording(false); setTranscribing(false); }
  }, []);
  const pressIn = useCallback(() => {
    if (!latest.current.enabled || phase.current !== "idle") return;
    phase.current = "starting";
    const current = ++generation.current;
    const valid = () => mounted.current && latest.current.enabled && generation.current === current;
    void (async () => {
      let recorder: PttRecorder | null = null;
      try {
        await latest.current.beforeStart();
        if (!valid()) return;
        recorder = await createPttRecorder({ deleteOnDispose: true });
        if (!valid()) { await recorder.dispose(); return; }
        recorderRef.current = recorder;
        await recorder.start();
        if (!valid()) { await recorder.dispose(); return; }
        phase.current = "recording"; setRecording(true);
      } catch (error) {
        await recorder?.dispose().catch(() => undefined);
        if (valid()) { recorderRef.current = null; phase.current = "idle"; latest.current.onError(error); }
      }
    })();
  }, []);
  const pressOut = useCallback(() => {
    if (phase.current === "starting") { cancel(); return; }
    if (phase.current !== "recording") return;
    const recorder = recorderRef.current; recorderRef.current = null;
    if (!recorder) return;
    phase.current = "transcribing"; setRecording(false); setTranscribing(true);
    const current = generation.current;
    const ac = new AbortController(); abortRef.current = ac;
    const valid = () => mounted.current && latest.current.enabled && generation.current === current && !ac.signal.aborted;
    void (async () => {
      try {
        const { uri, durationSeconds } = await recorder.stop();
        if (!valid() || durationSeconds < 0.4) { await deleteAskVRecording(uri); return; }
        const text = await transcribeAskVRecording(uri, ac.signal);
        if (valid() && text.trim()) await latest.current.onTranscript(text);
      } catch (error) { if (valid()) latest.current.onError(error); }
      finally {
        await recorder.dispose().catch(() => undefined);
        if (generation.current === current) {
          phase.current = "idle"; abortRef.current = null;
          if (mounted.current) setTranscribing(false);
        }
      }
    })();
  }, [cancel]);
  useEffect(() => { if (!options.enabled) cancel(); }, [options.enabled, cancel]);
  useEffect(() => {
    mounted.current = true;
    const app = subscribeAskVAppState(() => {}, cancel);
    return () => { mounted.current = false; app.remove(); cancel(); };
  }, [cancel]);
  return { recording, transcribing, pressIn, pressOut, cancel };
}
