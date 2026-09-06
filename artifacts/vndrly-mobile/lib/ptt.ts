import {
  AppState,
  InteractionManager,
  type AppStateStatus,
} from "react-native";

import { apiFetch, getApiBase } from "./api";
import { askVMicrophone } from "@workspace/askv-wake";

export type UploadResult = {
  objectPath: string;
  contentType: string;
  size: number;
};

const PTT_PREFIX = "[ptt:";

const BACKGROUND_AUDIO_RE =
  /background.*audio session|audio session could not be activated/i;

const RECORDING_BUSY_RE =
  /only one recording object can be prepared|recording not stopped|already prepared/i;

export function isRecordingBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return RECORDING_BUSY_RE.test(msg);
}

export class PttMicPermissionError extends Error {
  constructor() {
    super("Microphone permission denied");
    this.name = "PttMicPermissionError";
  }
}

export function isPttComment(content: string): boolean {
  return content.trim().startsWith(PTT_PREFIX);
}

export function pttDurationLabel(content: string): string | null {
  const m = /^\[ptt:([^\]]+)\]/.exec(content.trim());
  return m?.[1] ?? null;
}

/** Resolve a stored attachment path to a playable URL for expo-av. */
export function pttAttachmentPlayUri(url: string): string {
  if (url.startsWith("http")) return url;
  const base = getApiBase().replace(/\/$/, "");
  if (url.startsWith("/api/storage/")) return `${base}${url}`;
  return url;
}

export function isBackgroundAudioSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return BACKGROUND_AUDIO_RE.test(msg);
}

export async function waitForActiveAppState(maxWaitMs = 4000): Promise<void> {
  if (AppState.currentState === "active") return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.remove();
      reject(new Error("App is not in the foreground"));
    }, maxWaitMs);

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        clearTimeout(timeout);
        sub.remove();
        resolve();
      }
    });
  });
}

function runAfterInteractions(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBackgroundAudioRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  check: () => void = () => {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      check();
      await waitForActiveAppState();
      check();
      await runAfterInteractions();
      check();
      return await fn();
    } catch (err) {
      check();
      lastErr = err;
      if (!isBackgroundAudioSessionError(err) || i === attempts - 1) {
        throw err;
      }
      await sleep(120 * (i + 1));
    }
  }
  throw lastErr;
}

async function configureRecordingAudioMode(
  Audio: typeof import("expo-av").Audio,
  check: () => void,
): Promise<void> {
  const av = await import("expo-av");
  check();
  const mode: Record<string, unknown> = {
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  };

  if ("InterruptionModeIOS" in av && "InterruptionModeAndroid" in av) {
    const { InterruptionModeIOS, InterruptionModeAndroid } = av as {
      InterruptionModeIOS: { DuckOthers: number };
      InterruptionModeAndroid: { DuckOthers: number };
    };
    mode.interruptionModeIOS = InterruptionModeIOS.DuckOthers;
    mode.interruptionModeAndroid = InterruptionModeAndroid.DuckOthers;
  }

  await Audio.setAudioModeAsync(mode);
}

async function ensureMicPermission(check: () => void = () => {}): Promise<void> {
  // Share the permission-dialog counter with AskV's lifecycle observer.
  const { requestAskVMicrophonePermission } = await import("./askv-audio-session");
  check();
  try { await requestAskVMicrophonePermission(check); }
  catch (error) {
    if (error instanceof Error && error.message === "askv.microphoneDenied") throw new PttMicPermissionError();
    throw error;
  }
}

async function deleteOwnedRecording(uri: string | null): Promise<void> {
  if (!uri) return;
  const FileSystem = await import("expo-file-system/legacy");
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Permission warm-up must not alter the audio mode or stop another microphone owner. */
export async function warmUpPttSession(): Promise<void> {
  await waitForActiveAppState();
  await runAfterInteractions();
  await ensureMicPermission();
  await waitForActiveAppState();
}

function resolveUploadUrl(uploadURL: string): string {
  if (/^https?:\/\//i.test(uploadURL)) return uploadURL;
  const base = getApiBase().replace(/\/$/, "");
  return `${base}${uploadURL.startsWith("/") ? uploadURL : `/${uploadURL}`}`;
}

export async function uploadAudioBlob(
  uri: string,
  durationSeconds: number,
): Promise<UploadResult> {
  const contentType = "audio/mp4";
  const name = `ptt-${Date.now()}.m4a`;

  const presigned = await apiFetch<{ uploadURL: string; objectPath: string }>(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({ name, size: 0, contentType }),
    },
  );

  const blob = await fetch(uri).then((r) => r.blob());
  const putUrl = resolveUploadUrl(presigned.uploadURL);
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (HTTP ${putRes.status})`);
  }

  await apiFetch("/api/storage/uploads/finalize", {
    method: "POST",
    body: JSON.stringify({
      objectURL: presigned.uploadURL,
      visibility: "public",
    }),
  });

  return {
    objectPath: presigned.objectPath,
    contentType,
    size: blob.size,
  };
}

export async function postPttMessage(
  ticketId: number,
  uri: string,
  durationSeconds: number,
): Promise<void> {
  try {
    const uploaded = await uploadAudioBlob(uri, durationSeconds);
    const attachment = `${getApiBase()}/api/storage${uploaded.objectPath}`;
    const secs = Math.max(1, Math.round(durationSeconds));
    await apiFetch(`/api/tickets/${ticketId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: `[ptt:${secs}s]`, attachments: [attachment] }),
    });
  } finally {
    // A successful stop transfers this temporary file to the upload operation.
    await deleteOwnedRecording(uri).catch(() => undefined);
  }
}

export type PttRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<{ uri: string; durationSeconds: number }>;
  dispose: () => Promise<void>;
};

export type PttRecorderOptions = { deleteOnDispose?: boolean };

function cancelledRecording(): Error {
  return Object.assign(new Error("Recording cancelled"), { name: "AbortError" });
}

/** Each recorder owns one coordinator lease and only its own native recording/files. */
export async function createPttRecorder(options: PttRecorderOptions = {}): Promise<PttRecorder> {
  type Recording = InstanceType<typeof import("expo-av").Audio.Recording>;
  let recording: Recording | null = null;
  let startedAt = 0;
  let generation = 0;
  let disposed = false;
  let starting: Promise<void> | null = null;
  let nativeOperation: Promise<unknown> | null = null;
  let cleanupOperation: Promise<void> | null = null;
  let releaseLease: (() => Promise<void>) | null = null;
  let appSubscription: { remove(): void } | null = null;
  const returnedFiles = new Set<string>();

  const stopOwned = async () => {
    generation += 1;
    // Called inside coordinator acquisition/release: never recursively release this lease.
    releaseLease = null;
    appSubscription?.remove(); appSubscription = null;
    if (cleanupOperation) return cleanupOperation;
    const cleanup = (async () => {
      await nativeOperation?.catch(() => undefined);
      const rec = recording; recording = null;
      if (rec) {
        try { await rec.stopAndUnloadAsync(); }
        catch (error) {
          const status = await rec.getStatusAsync().catch(() => null);
          // Already-unloaded and never-prepared instances are safe. Unknown/live capture must block handoff.
          if (!status || status.isRecording || status.canRecord) { recording = rec; throw error; }
        }
        await deleteOwnedRecording(rec.getURI()).catch(() => undefined);
      }
    })();
    cleanupOperation = cleanup;
    try { await cleanup; }
    finally { if (cleanupOperation === cleanup) cleanupOperation = null; }
  };
  const dispose = async () => {
    disposed = true;
    const release = releaseLease; releaseLease = null;
    await stopOwned();
    await release?.();
    for (const uri of returnedFiles) await deleteOwnedRecording(uri).catch(() => undefined);
    returnedFiles.clear();
  };

  return {
    start() {
      if (disposed) return Promise.reject(cancelledRecording());
      if (starting || recording || nativeOperation) return Promise.reject(new Error("Recording already prepared"));
      const current = ++generation;
      const check = () => {
        if (disposed || generation !== current) throw cancelledRecording();
        if (AppState.currentState !== "active") throw new Error("App is not in the foreground");
      };
      const pending = (async () => {
        try {
          check();
          const lease = await askVMicrophone.acquire("ptt", stopOwned);
          if (disposed || generation !== current) { await lease(); throw cancelledRecording(); }
          releaseLease = lease;
          const { subscribeAskVAppState } = await import("./askv-audio-session");
          check();
          appSubscription = subscribeAskVAppState(() => {}, () => { void dispose().catch(() => undefined); });
          await ensureMicPermission(() => { if (disposed || generation !== current) throw cancelledRecording(); });
          if (disposed || generation !== current) throw cancelledRecording();
          await waitForActiveAppState();
          check();
          const { Audio } = await import("expo-av");
          check();
          const operation = (async () => {
            await withBackgroundAudioRetry(() => configureRecordingAudioMode(Audio, check), 4, check);
            check();
            // Own the instance before preparation, and check cancellation before native capture starts.
            const rec = new Audio.Recording();
            recording = rec;
            await rec.prepareToRecordAsync(Object.assign({}, Audio.RecordingOptionsPresets.HIGH_QUALITY, { keepAudioActiveHint: true }));
            check();
            await rec.startAsync();
            check();
            startedAt = Date.now();
          })();
          nativeOperation = operation;
          try { await operation; }
          finally { if (nativeOperation === operation) nativeOperation = null; }
        } catch (error) {
          const release = releaseLease; releaseLease = null;
          await stopOwned();
          await release?.();
          throw error;
        }
      })();
      starting = pending;
      void pending.finally(() => { if (starting === pending) starting = null; }).catch(() => undefined);
      return pending;
    },
    async stop() {
      if (!recording || starting || nativeOperation || disposed) throw new Error("Not recording");
      const current = generation;
      // Keep ownership visible during native stop so a handoff also waits for failed-stop cleanup.
      const rec = recording;
      const operation = rec.stopAndUnloadAsync();
      nativeOperation = operation;
      let uri: string | null = null;
      try {
        await operation;
        if (recording === rec) recording = null;
        uri = rec.getURI();
        if (disposed || generation !== current) throw cancelledRecording();
        if (!uri) throw new Error("No recording URI");
        if (options.deleteOnDispose) returnedFiles.add(uri);
        const durationSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
        return { uri, durationSeconds };
      } catch (error) {
        // A failed stop can leave a native recorder prepared; unload it before releasing ownership.
        const release = releaseLease; releaseLease = null;
        await stopOwned();
        await release?.();
        await deleteOwnedRecording(uri ?? rec.getURI()).catch(() => undefined);
        throw error;
      } finally {
        if (nativeOperation === operation) nativeOperation = null;
        const release = releaseLease; releaseLease = null;
        await release?.();
      }
    },
    dispose,
  };
}

export async function playPttUri(uri: string): Promise<void> {
  let cancelled = false;
  let sound: import("expo-av").Audio.Sound | null = null;
  let nativeOperation: Promise<unknown> | null = null;
  let endPlayback: (() => void) | null = null;
  const stopOwned = async () => {
    cancelled = true;
    await nativeOperation?.catch(() => undefined);
    const owned = sound; sound = null;
    try { await owned?.unloadAsync(); } catch { /* Already unloaded. */ }
    endPlayback?.();
  };
  const check = () => { if (cancelled) throw cancelledRecording(); };
  // Playback changes the shared iOS audio mode, so it participates in the same ownership handoff.
  const release = await askVMicrophone.acquire("ptt-playback", stopOwned);
  try {
    const { Audio } = await import("expo-av");
    check();
    const prepare = withBackgroundAudioRetry(async () => {
      check();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: false,
        shouldDuckAndroid: true, playThroughEarpieceAndroid: false,
      });
      check();
      const result = await Audio.Sound.createAsync({ uri });
      sound = result.sound;
      check();
    }, 4, check);
    nativeOperation = prepare;
    try { await prepare; } finally { if (nativeOperation === prepare) nativeOperation = null; }
    check();
    const owned = sound!;
    await new Promise<void>((resolve, reject) => {
      endPlayback = resolve;
      owned.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if (status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
      });
      void owned.playAsync().catch(reject);
    });
  } finally { await release(); }
}
