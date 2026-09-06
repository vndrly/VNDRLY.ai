import { askVMicrophone } from "@workspace/askv-wake";
export type GateAudioStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

export type GateAudioRecorder = {
  mimeType: string;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: (() => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type GateAudioSessionOptions = {
  getStream: () => Promise<GateAudioStream>;
  createRecorder: (
    stream: GateAudioStream,
    mimeType?: string,
  ) => GateAudioRecorder;
  onAudio: (audio: Blob) => void | Promise<void>;
  onListeningChange: (listening: boolean) => void;
  onError: (code: string) => void;
  mimeType?: string;
};

export type GateAudioSession = {
  dispose: () => Promise<void>;
  isListening: () => boolean;
  stop: (cancel?: boolean) => Promise<void>;
  toggle: () => Promise<void>;
};

export function pickGateRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
  ].find((type) => MediaRecorder.isTypeSupported(type));
}

/** A press-on/press-off recorder that shares the app's single microphone lease. */
export function createGateAudioSession(
  options: GateAudioSessionOptions,
): GateAudioSession {
  type Recording = {
    recorder: GateAudioRecorder;
    stream: GateAudioStream;
    chunks: Blob[];
    cancelled: boolean;
    normalStop: boolean;
    finished: boolean;
  };
  let desired = false;
  let disposed = false;
  let listening = false;
  let generation = 0;
  let current: Recording | null = null;
  let starting: Promise<void> | null = null;
  let permission: Promise<GateAudioStream> | null = null;
  let releaseLease: (() => Promise<void>) | null = null;
  const stoppedStreams = new WeakSet<GateAudioStream>();

  const publishListening = (next: boolean) => {
    if (listening === next) return;
    listening = next;
    options.onListeningChange(next);
  };
  const stopStream = (stream: GateAudioStream) => {
    if (stoppedStreams.has(stream)) return;
    stoppedStreams.add(stream);
    for (const track of stream.getTracks()) track.stop();
  };
  const releaseOwnership = async () => {
    const release = releaseLease;
    releaseLease = null;
    if (release) await release();
  };
  const finalize = (recording: Recording) => {
    if (recording.finished) return;
    recording.finished = true;
    stopStream(recording.stream);
    if (current === recording) {
      current = null;
      desired = false;
      publishListening(false);
      // Never await lease release in a coordinator stop callback: it is queued
      // behind that callback. Hardware is already stopped synchronously above.
      void releaseOwnership();
    }
    if (recording.cancelled || disposed || !recording.chunks.length) return;
    const mimeType =
      recording.recorder.mimeType ||
      recording.chunks.find((part) => part.type)?.type ||
      options.mimeType ||
      "audio/webm";
    void Promise.resolve()
      .then(() =>
        options.onAudio(new Blob(recording.chunks, { type: mimeType })),
      )
      .catch(() => {
        if (!disposed) options.onError("transcription-failed");
      });
  };
  const stopCapture = async (cancel: boolean) => {
    desired = false;
    generation++;
    const recording = current;
    if (recording) {
      recording.cancelled ||= cancel && !recording.normalStop;
      stopStream(recording.stream);
      try {
        if (recording.recorder.state !== "inactive") recording.recorder.stop();
        else finalize(recording);
      } catch {
        recording.cancelled = true;
        finalize(recording);
      }
    }
    publishListening(false);
    // Wait only for the native permission request, never `starting` (which can
    // itself be queued behind this coordinator callback).
    const pendingPermission = permission;
    if (pendingPermission) {
      try {
        stopStream(await pendingPermission);
      } catch {
        /* Permission denied. */
      }
    }
  };
  const start = async (requestGeneration: number) => {
    let captured: GateAudioStream | null = null;
    try {
      const release = await askVMicrophone.acquire("gate", () =>
        stopCapture(true),
      );
      if (!desired || disposed || generation !== requestGeneration) {
        await release();
        return;
      }
      releaseLease = release;
      permission = options.getStream();
      const acquired = await permission;
      captured = acquired;
      permission = null;
      if (!desired || disposed || generation !== requestGeneration) {
        stopStream(acquired);
        await releaseOwnership();
        return;
      }
      const recorder = options.createRecorder(acquired, options.mimeType);
      const recording: Recording = {
        recorder,
        stream: acquired,
        chunks: [],
        cancelled: false,
        normalStop: false,
        finished: false,
      };
      current = recording;
      recorder.ondataavailable = (event) => {
        if (!recording.finished && event.data.size)
          recording.chunks.push(event.data);
      };
      recorder.onstop = () => finalize(recording);
      recorder.onerror = () => {
        recording.cancelled = true;
        if (!disposed) options.onError("recording-failed");
        void stopCapture(true).then(releaseOwnership);
      };
      try {
        recorder.start();
      } catch (error) {
        stopStream(acquired);
        throw error;
      }
      publishListening(true);
    } catch (error) {
      if (captured) stopStream(captured);
      permission = null;
      const report = desired && !disposed && generation === requestGeneration;
      await stopCapture(true);
      await releaseOwnership();
      if (report) {
        const name = error instanceof DOMException ? error.name : "";
        options.onError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "not-allowed"
            : "start-failed",
        );
      }
    }
  };
  const stop = async (cancel = false) => {
    if (current) current.normalStop = !cancel;
    await stopCapture(cancel);
    await releaseOwnership();
  };
  return {
    dispose: async () => {
      disposed = true;
      await stop(true);
    },
    isListening: () => listening,
    stop,
    toggle: async () => {
      if (disposed) return;
      if (desired || listening || starting) {
        await stop();
        return;
      }
      desired = true;
      const task = start(++generation);
      starting = task;
      try {
        await task;
      } finally {
        if (starting === task) starting = null;
      }
    },
  };
}
