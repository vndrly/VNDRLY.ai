import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";

import { apiFetchRaw } from "./api";
import type { AuthScope } from "./auth";
import { nativeUuid } from "./native-uuid";

export type MeetingFileSource = "camera" | "photos" | "files";
export type OwnedMeetingFile = { id: string; name: string; type: string; size: number; bytes: Uint8Array };

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf", "text/plain",
]);

export class MeetingFileFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MeetingFileFailure";
  }
}

type Picked = {
  uri: string;
  name?: string | null;
  fileName?: string | null;
  type?: string | null;
  mimeType?: string | null;
  size?: number;
  fileSize?: number;
  bytes?: () => Promise<Uint8Array>;
};

function pickerCancelled(error: unknown) {
  return ["ERR_CANCELED", "ERR_CANCELLED", "DOCUMENT_PICKER_CANCELED"]
    .includes((error as { code?: string } | null)?.code ?? "");
}

async function readPicked(picked: Picked): Promise<OwnedMeetingFile> {
  const type = String(picked.mimeType || picked.type || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_TYPES.has(type)) throw new MeetingFileFailure("validation.type");
  const declaredSize = picked.fileSize ?? picked.size;
  if (typeof declaredSize === "number" && Number.isFinite(declaredSize) && declaredSize > MAX_BYTES)
    throw new MeetingFileFailure("validation.size");
  let bytes: Uint8Array;
  try {
    bytes = picked.bytes ? await picked.bytes() : await new File(picked.uri).bytes();
  } catch {
    throw new MeetingFileFailure("validation.unreadable");
  }
  if (bytes.byteLength === 0) throw new MeetingFileFailure("validation.empty");
  if (bytes.byteLength > MAX_BYTES) throw new MeetingFileFailure("validation.size");
  return {
    id: nativeUuid(),
    name: picked.name || picked.fileName || `meeting-file-${Date.now()}`,
    type,
    size: bytes.byteLength,
    bytes: new Uint8Array(bytes),
  };
}

export async function pickMeetingFile(source: MeetingFileSource): Promise<OwnedMeetingFile | null> {
  try {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== "granted") throw new MeetingFileFailure("permission.camera");
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });
      return result.canceled || !result.assets?.[0] ? null : readPicked(result.assets[0]);
    }
    if (source === "photos") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") throw new MeetingFileFailure("permission.photos");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });
      return result.canceled || !result.assets?.[0] ? null : readPicked(result.assets[0]);
    }
    const picked = await File.pickFileAsync(
      undefined,
      "*/*",
    );
    const single = Array.isArray(picked) ? picked[0] : picked;
    return single ? readPicked(single) : null;
  } catch (error) {
    if (pickerCancelled(error)) return null;
    throw error;
  }
}

export async function uploadMeetingFile(
  occurrenceId: string,
  file: OwnedMeetingFile,
  recipientUserId: number | null,
  authScope: AuthScope,
  signal?: AbortSignal,
) {
  const recipient = recipientUserId === null ? "" : `?recipient=${encodeURIComponent(String(recipientUserId))}`;
  const bodyBytes = new Uint8Array(file.bytes.byteLength);
  bodyBytes.set(file.bytes);
  const response = await apiFetchRaw(
    `/api/work-hub/meetings/${encodeURIComponent(occurrenceId)}/files/${encodeURIComponent(file.id)}${recipient}`,
    {
      method: "PUT",
      headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) },
      body: new Blob([bodyBytes.buffer], { type: file.type }),
      signal,
    },
    authScope,
  );
  return response.json() as Promise<{
    attachment: { fileName: string; contentType: string; byteSize: number; removedAt?: string };
    replayed: boolean;
  }>;
}

export function persistMeetingFileForOffline(file: OwnedMeetingFile) {
  const directory = new Directory(Paths.document, "work-hub-queue");
  directory.create({ idempotent: true, intermediates: true });
  const persisted = new File(directory, file.id);
  persisted.create({ overwrite: true, intermediates: true });
  persisted.write(file.bytes);
  return persisted.uri;
}

type DownloadInput = {
  occurrenceId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  authScope: AuthScope;
  assertCurrent: () => void;
  signal?: AbortSignal;
  registerTemporaryCleanup?: (cleanup: (() => void) | null) => void;
};

type ReplayDownloadInput = Omit<DownloadInput, "fileId"> & {
  replayEventId: string;
};

const normalizedType = (value: string | null) => (value ?? "").toLowerCase().split(";")[0].trim();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "meeting-file";

async function downloadAndShareProtectedMeetingFile(
  input: Omit<DownloadInput, "fileId">,
  path: string,
  headers?: Record<string, string>,
): Promise<void> {
  let temporary: File | null = null;
  try {
    input.assertCurrent();
    const response = await apiFetchRaw(
      path,
      { method: "GET", signal: input.signal, ...(headers ? { headers } : {}) },
      input.authScope,
    );
    input.assertCurrent();
    const advertisedLength = Number(response.headers.get("content-length"));
    if (!Number.isFinite(advertisedLength) || advertisedLength !== input.byteSize || advertisedLength <= 0 || advertisedLength > MAX_BYTES)
      throw new MeetingFileFailure("download.length");
    if (normalizedType(response.headers.get("content-type")) !== normalizedType(input.contentType))
      throw new MeetingFileFailure("download.type");
    const bytes = new Uint8Array(await response.arrayBuffer());
    input.assertCurrent();
    if (bytes.byteLength !== input.byteSize || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
      throw new MeetingFileFailure("download.length");
    temporary = new File(Paths.cache, `${nativeUuid()}-${safeName(input.fileName)}`);
    temporary.create();
    temporary.write(bytes);
    const deleteTemporary = () => { try { temporary?.delete(); } catch { /* best-effort cleanup */ } };
    input.registerTemporaryCleanup?.(deleteTemporary);
    input.assertCurrent();
    if (!await Sharing.isAvailableAsync()) throw new MeetingFileFailure("share.unavailable");
    input.assertCurrent();
    try {
      await Sharing.shareAsync(temporary.uri, { mimeType: input.contentType, dialogTitle: input.fileName });
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") throw cause;
      throw new MeetingFileFailure("share.failed");
    }
    input.assertCurrent();
  } finally {
    try { temporary?.delete(); } catch { /* best-effort cleanup */ }
    input.registerTemporaryCleanup?.(null);
  }
}

export async function downloadAndShareMeetingFile(input: DownloadInput): Promise<void> {
  return downloadAndShareProtectedMeetingFile(
    input,
    `/api/work-hub/meetings/${encodeURIComponent(input.occurrenceId)}/files/${encodeURIComponent(input.fileId)}`,
  );
}

export async function downloadAndShareMeetingReplayFile(input: ReplayDownloadInput): Promise<void> {
  return downloadAndShareProtectedMeetingFile(
    input,
    `/api/work-hub/meetings/${encodeURIComponent(input.occurrenceId)}/replay/files/${encodeURIComponent(input.replayEventId)}`,
    { "x-replay-renderer-version": "1", "x-replay-schema-version": "2" },
  );
}
