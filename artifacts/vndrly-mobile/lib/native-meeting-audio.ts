import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { createMobileMeetingStreamingClient } from "./meeting-streaming";

export type NativeMeetingPCMFrame = {
  generation: number;
  sourceId: string;
  sequence: number;
  pcmBase64: string;
  policyRevision: number;
  sampleRate: 16000;
  channels: 1;
  sampleCount: 8000;
  firstSample: number;
};

export type NativeMeetingSignal = {
  generation: number;
  toUserId: number;
  kind: "offer" | "answer" | "ice";
  payload: unknown;
};

type NativeMeetingModule = {
  createSession(options: { occurrenceId: string; generation: number; sourceId: string; iceServers: unknown[] }): Promise<void>;
  setMuted(options: { generation: number; muted: boolean }): Promise<void>;
  setTranscription(options: { generation: number; enabled: boolean; policyRevision: number }): Promise<void>;
  acknowledgeFrame(options: { generation: number; sequence: number }): Promise<void>;
  createOffer(options: { generation: number; peerUserId: number }): Promise<void>;
  applySignal(options: { generation: number; peerUserId: number; kind: string; payload: unknown }): Promise<void>;
  removePeer(options: { generation: number; peerUserId: number }): Promise<void>;
  invalidateSession(options: { generation: number }): void;
  addListener(event: string, callback: (event: any) => void): { remove(): void };
};

type StreamingClient = ReturnType<typeof createMobileMeetingStreamingClient>;

export type NativeMeetingAudioSession = {
  start(options: { sourceId: string; iceServers: unknown[] }): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setTranscription(enabled: boolean, policyRevision: number): Promise<void>;
  createOffer(peerUserId: number): Promise<void>;
  applySignal(peerUserId: number, kind: string, payload: unknown): Promise<void>;
  removePeer(peerUserId: number): Promise<void>;
  stop(): Promise<void>;
};

export function createNativeMeetingAudioSession(options: {
  occurrenceId: string;
  generation: number;
  streamingClient?: StreamingClient;
  onSignal?: (signal: NativeMeetingSignal) => void;
  onError?: (code: string) => void;
}): NativeMeetingAudioSession | null {
  if (Platform.OS !== "ios") return null;
  let native: NativeMeetingModule | null;
  try { native = requireOptionalNativeModule<NativeMeetingModule>("WorkHubMeeting"); }
  catch { native = null; }
  if (!native) {
    throw Object.assign(
      new Error("Native meeting audio is unavailable in this iOS build."),
      { code: "NATIVE_MEETING_AUDIO_UNAVAILABLE" },
    );
  }

  const stream = options.streamingClient ?? createMobileMeetingStreamingClient(options.occurrenceId);
  const sessionController = new AbortController();
  let streamController: AbortController | null = null;
  const subscriptions: Array<{ remove(): void }> = [];
  let alive = true;
  let started = false;
  let sourceId = "";
  let transcription = false;
  let activePolicyRevision = 0;
  let expectedSequence = 0;
  let expectedFirstSample = 0;
  let stopping: Promise<void> | null = null;
  const pendingFrames: NativeMeetingPCMFrame[] = [];
  let uploadTask: Promise<void> | null = null;

  const stop = () => {
    if (stopping) return stopping;
    alive = false;
    native!.invalidateSession({ generation: options.generation });
    sessionController.abort();
    streamController?.abort();
    streamController = null;
    subscriptions.splice(0).forEach(subscription => subscription.remove());
    transcription = false;
    pendingFrames.splice(0);
    stopping = stream.close();
    return stopping;
  };

  const fail = (code: string) => {
    if (!alive) return;
    void stop().finally(() => options.onError?.(code));
  };

  const drainFrames = (uploadController: AbortController) => {
    if (uploadTask) return;
    uploadTask = (async () => {
      while (alive && transcription && streamController === uploadController && !uploadController.signal.aborted) {
        const frame = pendingFrames[0];
        if (!frame) break;
        await stream.sendBase64AndPersist(frame.sequence, frame.pcmBase64, stream.persistTurn.bind(stream), uploadController.signal);
        if (!alive || !transcription || streamController !== uploadController || uploadController.signal.aborted || frame.policyRevision !== activePolicyRevision) return;
        await native!.acknowledgeFrame({ generation: options.generation, sequence: frame.sequence });
        if (!alive || streamController !== uploadController || uploadController.signal.aborted) return;
        if (pendingFrames[0] !== frame) {
          throw Object.assign(new Error("Native meeting frame ordering changed."), { code: "AUDIO_SEQUENCE_GAP" });
        }
        pendingFrames.shift();
      }
    })().catch(error => {
      if (alive && streamController === uploadController && !uploadController.signal.aborted) {
        fail(error?.code ?? "TRANSCRIPTION_UNAVAILABLE");
      }
    }).finally(() => {
      uploadTask = null;
      if (alive && transcription && streamController === uploadController && pendingFrames.length) drainFrames(uploadController);
    });
  };

  subscriptions.push(
    native.addListener("onMeetingSignal", (event: NativeMeetingSignal) => {
      if (!alive || event.generation !== options.generation) return;
      options.onSignal?.(event);
    }),
    native.addListener("onMeetingError", (event: { generation: number; code: string }) => {
      if (alive && event.generation === options.generation) fail(event.code || "AUDIO_UNAVAILABLE");
    }),
    native.addListener("onMeetingPCMFrame", (frame: NativeMeetingPCMFrame) => {
      if (!alive || !transcription || frame.generation !== options.generation || frame.sourceId !== sourceId) return;
      if (frame.policyRevision !== activePolicyRevision) {
        fail("AUDIO_POLICY_CHANGED"); return;
      }
      if (frame.sampleRate !== 16000 || frame.channels !== 1 || frame.sampleCount !== 8000 || typeof frame.pcmBase64 !== "string" || !frame.pcmBase64) {
        fail("AUDIO_FORMAT_UNSUPPORTED"); return;
      }
      if (frame.sequence !== expectedSequence || frame.firstSample !== expectedFirstSample) {
        fail("AUDIO_SEQUENCE_GAP"); return;
      }
      expectedSequence += 1;
      expectedFirstSample += 8000;
      const uploadController = streamController;
      if (!uploadController) { fail("TRANSCRIPTION_UNAVAILABLE"); return; }
      if (pendingFrames.length >= 2) { fail("AUDIO_BACKPRESSURE"); return; }
      pendingFrames.push(frame);
      drainFrames(uploadController);
    }),
  );

  return {
    async start(startOptions) {
      if (!alive) throw Object.assign(new Error("Meeting audio stopped"), { name: "AbortError" });
      if (started) return;
      sourceId = startOptions.sourceId;
      await native!.createSession({ occurrenceId: options.occurrenceId, generation: options.generation, sourceId, iceServers: startOptions.iceServers });
      if (!alive) throw Object.assign(new Error("Meeting audio stopped"), { name: "AbortError" });
      started = true;
    },
    async setMuted(muted) {
      if (!alive || !started) return;
      if (muted && (transcription || streamController)) await this.setTranscription(false, 0);
      await native!.setMuted({ generation: options.generation, muted });
    },
    async setTranscription(enabled, policyRevision) {
      if (!alive || !started) return;
      if (!enabled) {
        transcription = false;
        activePolicyRevision = policyRevision;
        const closingController = streamController;
        streamController = null;
        closingController?.abort();
        await native!.setTranscription({ generation: options.generation, enabled: false, policyRevision });
        await stream.close();
        return;
      }
      let openingController: AbortController | null = null;
      try {
        if (transcription && activePolicyRevision === policyRevision) return;
        if (transcription) await this.setTranscription(false, policyRevision);
        openingController = new AbortController();
        streamController = openingController;
        await stream.open(openingController.signal);
        if (!alive || streamController !== openingController || openingController.signal.aborted) return;
        if (uploadTask) await uploadTask;
        expectedSequence = 0; expectedFirstSample = 0; pendingFrames.splice(0);
        activePolicyRevision = policyRevision;
        await native!.setTranscription({ generation: options.generation, enabled: true, policyRevision });
        if (alive && streamController === openingController && !openingController.signal.aborted) transcription = true;
      } catch (error) {
        const expectedCancellation = !alive || !!openingController?.signal.aborted || (!!openingController && streamController !== openingController);
        if (streamController === openingController) streamController = null;
        openingController?.abort();
        if (expectedCancellation) return;
        sessionController.abort();
        if (alive) fail("TRANSCRIPTION_UNAVAILABLE");
        throw error;
      }
    },
    createOffer(peerUserId) { return native!.createOffer({ generation: options.generation, peerUserId }); },
    applySignal(peerUserId, kind, payload) { return native!.applySignal({ generation: options.generation, peerUserId, kind, payload }); },
    removePeer(peerUserId) { return native!.removePeer({ generation: options.generation, peerUserId }); },
    stop,
  };
}
