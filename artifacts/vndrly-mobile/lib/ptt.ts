import { apiFetch, getApiBase } from "./api";

export type UploadResult = {
  objectPath: string;
  contentType: string;
  size: number;
};

const PTT_PREFIX = "[ptt:";

export function isPttComment(content: string): boolean {
  return content.trim().startsWith(PTT_PREFIX);
}

export function pttDurationLabel(content: string): string | null {
  const m = /^\[ptt:([^\]]+)\]/.exec(content.trim());
  return m?.[1] ?? null;
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
  const { Audio } = await import("expo-av");
  await Audio.requestPermissionsAsync();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  let recording: InstanceType<typeof Audio.Recording> | null = null;
  let startedAt = 0;

  return {
    async start() {
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      await rec.startAsync();
      recording = rec;
      startedAt = Date.now();
    },
    async stop() {
      if (!recording) throw new Error("Not recording");
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recording = null;
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
    },
  };
}

export async function playPttUri(uri: string): Promise<void> {
  const { Audio } = await import("expo-av");
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.createAsync({ uri });
  await sound.playAsync();
}
