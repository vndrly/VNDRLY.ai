import {
  AppState,
  InteractionManager,
  type AppStateStatus,
} from "react-native";

import { apiFetch, getApiBase } from "./api";

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
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await waitForActiveAppState();
      await runAfterInteractions();
      return await fn();
    } catch (err) {
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
): Promise<void> {
  const av = await import("expo-av");
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

async function ensureMicPermission(
  Audio: typeof import("expo-av").Audio,
): Promise<void> {
  const current = await Audio.getPermissionsAsync();
  if (current.status === "granted") return;

  const requested = await Audio.requestPermissionsAsync();
  if (requested.status !== "granted") {
    throw new PttMicPermissionError();
  }
}

/** Tracks the one expo-av Recording instance allowed at a time. */
let activeRecording: InstanceType<
  typeof import("expo-av").Audio.Recording
> | null = null;

async function releaseActiveRecording(): Promise<void> {
  if (!activeRecording) return;
  try {
    const status = await activeRecording.getStatusAsync();
    if (status.isRecording || status.canRecord) {
      await activeRecording.stopAndUnloadAsync();
    }
  } catch {
    try {
      await activeRecording.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
  }
  activeRecording = null;
}

/** Pre-request mic permission when the Comms screen is focused. */
export async function warmUpPttSession(): Promise<void> {
  await waitForActiveAppState();
  await runAfterInteractions();
  await releaseActiveRecording();
  const { Audio } = await import("expo-av");
  await ensureMicPermission(Audio);
  await withBackgroundAudioRetry(() => configureRecordingAudioMode(Audio));
}

async function activateRecordingSession(): Promise<
  typeof import("expo-av").Audio
> {
  await waitForActiveAppState();
  await runAfterInteractions();
  const { Audio } = await import("expo-av");
  await ensureMicPermission(Audio);
  await withBackgroundAudioRetry(() => configureRecordingAudioMode(Audio));
  return Audio;
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
  const uploaded = await uploadAudioBlob(uri, durationSeconds);
  const attachment = `${getApiBase()}/api/storage${uploaded.objectPath}`;
  const secs = Math.max(1, Math.round(durationSeconds));
  await apiFetch(`/api/tickets/${ticketId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      content: `[ptt:${secs}s]`,
      attachments: [attachment],
    }),
  });
}

export type PttRecorder = {
  start: () => Promise<void>;
  stop: () => Promise<{ uri: string; durationSeconds: number }>;
  dispose: () => Promise<void>;
};

/** Lazy-load expo-av so web / tests without native module still compile. */
export async function createPttRecorder(): Promise<PttRecorder> {
  let recording: InstanceType<
    typeof import("expo-av").Audio.Recording
  > | null = null;
  let startedAt = 0;

  return {
    async start() {
      await releaseActiveRecording();
      const Audio = await activateRecordingSession();
      await withBackgroundAudioRetry(async () => {
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recording = rec;
        activeRecording = rec;
        startedAt = Date.now();
      });
    },
    async stop() {
      if (!recording) throw new Error("Not recording");
      const rec = recording;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recording = null;
      if (activeRecording === rec) activeRecording = null;
      if (!uri) throw new Error("No recording URI");
      const durationSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
      return { uri, durationSeconds };
    },
    async dispose() {
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        recording = null;
      }
      if (activeRecording) {
        await releaseActiveRecording();
      }
    },
  };
}

export async function playPttUri(uri: string): Promise<void> {
  await releaseActiveRecording();
  const { Audio } = await import("expo-av");
  await withBackgroundAudioRetry(() =>
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }),
  );
  const { sound } = await Audio.createAsync({ uri });
  try {
    await sound.playAsync();
    await new Promise<void>((resolve, reject) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) resolve();
        if ("error" in status && status.error) {
          reject(new Error(String(status.error)));
        }
      });
    });
  } finally {
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
  }
}
