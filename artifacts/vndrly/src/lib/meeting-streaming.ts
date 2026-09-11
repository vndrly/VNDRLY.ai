import { MeetingStreamingClient, type MeetingStreamingTurn } from "@workspace/api-client-react/meeting-streaming";
import type { MeetingSnapshot } from "./meeting-types";
import { MeetingPcmBatcher } from "./meeting-pcm";

export { MeetingStreamingClient, type MeetingStreamingTurn };

export function meetingStreamingAllowed(snapshot: MeetingSnapshot | undefined, joined: boolean, muted: boolean) {
  const person = snapshot?.participants.find((participant) => participant.userId === snapshot.userId);
  return Boolean(joined && !muted && snapshot?.transcription && snapshot.myConsent === "accepted" && snapshot.streamingCaptureAvailable === true
    && snapshot.occurrence.askvInvitedAt && snapshot.occurrence.status === "live" && person?.present && !person.removedAt);
}

type StreamingCaptureOptions = {
  occurrenceId: string;
  input: MediaStream;
  startedAtMs: number;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
  createAudioContext?: () => AudioContext;
  createWorkletNode?: (context: AudioContext) => AudioWorkletNode;
};

/** Processes the already-open call microphone; it never acquires or stops call tracks. */
export async function startMeetingStreamingCapture(options: StreamingCaptureOptions) {
  options.signal.throwIfAborted();
  const client = new MeetingStreamingClient(options.occurrenceId);
  const controller = new AbortController();
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let pending = 0;
  let sequence = 0;
  let stopped = false;
  let queue = Promise.resolve();
  const cancel = () => { controller.abort(options.signal.reason); void stop(); };
  const stop = async () => {
    if (stopped) return; stopped = true; controller.abort();
    options.signal.removeEventListener("abort", cancel);
    node?.port.close(); node?.disconnect(); source?.disconnect();
    await context?.close().catch(() => undefined);
    await client.close();
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  const fail = (error: unknown) => { if (!stopped) { options.onError?.(error); void stop(); } };
  try {
    const handle = await client.open(controller.signal); controller.signal.throwIfAborted();
    context = options.createAudioContext?.() ?? new AudioContext();
    await context.audioWorklet.addModule("/meeting-pcm-worklet.js"); controller.signal.throwIfAborted();
    const batcher = new MeetingPcmBatcher(context.sampleRate, handle.frameDurationMs);
    source = context.createMediaStreamSource(options.input);
    node = options.createWorkletNode?.(context) ?? new AudioWorkletNode(context, "vndrly-meeting-pcm", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (stopped || controller.signal.aborted || !event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; sequence?: unknown; samples?: unknown };
      if (message.type === "overflow") {
        fail(new Error("Meeting transcription stopped because audio was consumed too slowly."));
        return;
      }
      if (message.type !== "audio" || !Number.isSafeInteger(message.sequence) || !(message.samples instanceof Float32Array)) return;
      for (const frame of batcher.push(message.samples)) {
        if (pending >= 4) { fail(new Error("Meeting transcription is receiving audio too quickly and has paused.")); return; }
        const frameSequence = sequence++; pending += 1;
        queue = queue.then(() => client.sendAndPersist(frameSequence, frame, (turn, signal) => client.persistTurn(turn, signal), controller.signal))
          .catch(fail).finally(() => { pending = Math.max(0, pending - 1); });
      }
      if (!stopped) node?.port.postMessage({ type: "ack", sequence: message.sequence });
    };
    source.connect(node); await context.resume(); controller.signal.throwIfAborted();
    return { stop };
  } catch (error) {
    await stop(); throw error;
  }
}
