import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod/v4";
import NativeCapture from "../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule";
import { apiFetch, getApiBase } from "./api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
  type AuthScope,
} from "./auth";
import { currentNativeCaptureContext } from "./native-capture-context";
import { nativeCaptureBinding } from "./native-capture-context-policy";
import { validateNativeUploadDestination } from "./native-work-capture-policy";
import { nativeUuid } from "./native-uuid";
import type { OwnedMeetingFile } from "./meeting-files";
import {
  BackgroundUploadPendingSchema,
  progressBackgroundUpload,
  type BackgroundUploadPending,
} from "./work-hub-background-upload";
const KEY = "vndrly.work-upload",
  CHUNK = 400,
  MAX_CHUNKS = 32;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>) {
  const result = serial.then(work, work);
  serial = result.catch(() => undefined);
  return result;
}
const metaSchema = z
  .object({
    slot: z.union([z.literal(0), z.literal(1)]),
    count: z.number().int().min(0).max(MAX_CHUNKS),
  })
  .strict();
function journalKey(account: BackgroundUploadPending["account"]) {
  return `${KEY}.${account.userId}.${account.membershipId}.${account.orgType}.${account.orgId}.${account.sessionVersion}`;
}
async function journal(account: BackgroundUploadPending["account"]) {
  const key = journalKey(account);
  const raw = await SecureStore.getItemAsync(`${key}.meta`, options);
  if (!raw) return null;
  const meta = metaSchema.parse(JSON.parse(raw));
  let text = "";
  for (let i = 0; i < meta.count; i++) {
    const part = await SecureStore.getItemAsync(
      `${key}.${meta.slot}.${i}`,
      options,
    );
    if (part === null) throw new Error("upload_journal_invalid");
    text += part;
  }
  if (!text) return null;
  return BackgroundUploadPendingSchema.parse(JSON.parse(text));
}
async function persist(value: BackgroundUploadPending, current: () => boolean) {
  const key = journalKey(value.account);
  const text = JSON.stringify(BackgroundUploadPendingSchema.parse(value));
  if (
    new TextEncoder().encode(text).byteLength > 12 * 1024 ||
    text.length > CHUNK * MAX_CHUNKS
  )
    throw new Error("upload_journal_too_large");
  const old = metaSchema.parse(
    JSON.parse(
      (await SecureStore.getItemAsync(`${key}.meta`, options)) ??
        '{"slot":1,"count":0}',
    ),
  );
  const characters = Array.from(text);
  const slot = old.slot === 0 ? 1 : 0,
    count = Math.ceil(characters.length / CHUNK);
  for (let i = 0; i < count; i++) {
    if (!current()) throw new Error("native_work_capture_account_changed");
    await SecureStore.setItemAsync(
      `${key}.${slot}.${i}`,
      characters.slice(i * CHUNK, (i + 1) * CHUNK).join(""),
      options,
    );
  }
  if (!current()) throw new Error("native_work_capture_account_changed");
  await SecureStore.setItemAsync(
    `${key}.meta`,
    JSON.stringify({ slot, count }),
    options,
  );
}
async function clear(account: BackgroundUploadPending["account"]) {
  const key = journalKey(account);
  await SecureStore.deleteItemAsync(`${key}.meta`, options);
  for (let slot = 0; slot < 2; slot++)
    for (let i = 0; i < MAX_CHUNKS; i++)
      await SecureStore.deleteItemAsync(`${key}.${slot}.${i}`, options);
}
function native() {
  if (Platform.OS !== "ios" || !NativeCapture)
    throw new Error("native_work_capture_unavailable");
  return NativeCapture;
}
export async function canBackgroundUploadWorkFile() {
  try {
    return (
      Platform.OS === "ios" &&
      !!NativeCapture &&
      (await NativeCapture.getCapabilities()).backgroundUpload
    );
  } catch {
    return false;
  }
}
async function context(scope: AuthScope) {
  const result = await currentNativeCaptureContext(scope);
  await native().setContext(result.binding);
  result.assertCurrent();
  return result;
}
export async function readPendingWorkUpload() {
  return exclusive(async () => {
    const fresh = await currentNativeCaptureContext();
    const value = await journal(fresh.account);
    if (!value) return null;
    if (nativeCaptureBinding(value.account) !== fresh.binding) return null;
    fresh.assertCurrent();
    return {
      name: value.reserve.payload.fileName,
      scope: value.reserve.payload.scope,
      stagedFileId: value.staged.fileId,
      transported: value.transportComplete,
      finalized: value.canonicalSaved,
      documentId: value.reserved?.documentId ?? null,
    };
  });
}
export async function beginBackgroundWorkUpload(
  input: {
    file: OwnedMeetingFile;
    owner: { type: "vendor" | "partner"; id: number };
    scope: "personal" | "company" | "channel";
    channelId?: string;
  },
  scope: AuthScope = captureAuthScope(),
) {
  return exclusive(async () => {
    const current = () => isAuthScopeCurrent(scope);
    const fresh = await context(scope);
    if (await journal(fresh.account))
      throw new Error("work_upload_pending_exists");
    const { File, Paths } = await import("expo-file-system");
    fresh.assertCurrent();
    const source = new File(Paths.cache, `work-upload-source-${nativeUuid()}`);
    let staged: BackgroundUploadPending["staged"];
    try {
      fresh.assertCurrent();
      source.create();
      source.write(input.file.bytes);
      fresh.assertCurrent();
      staged = await native().stageFile({
        contextBinding: fresh.binding,
        uri: source.uri,
      });
      fresh.assertCurrent();
    } finally {
      try {
        source.delete();
      } catch {}
    }
    const value = BackgroundUploadPendingSchema.parse({
      account: fresh.account,
      staged,
      jobId: nativeUuid(),
      finalizeOperationId: nativeUuid(),
      reserve: {
        operationId: nativeUuid(),
        owner: input.owner,
        context: { kind: "organization", id: input.owner.id },
        payloadVersion: 1,
        expectedVersion: null,
        payload: {
          scope: input.scope,
          ...(input.scope === "channel" ? { channelId: input.channelId } : {}),
          fileName: input.file.name,
          contentType: input.file.type,
          byteSize: staged.byteSize,
          checksumSha256: staged.sha256,
        },
      },
      reserved: null,
      reserveSent: false,
      transportComplete: false,
      finalizeSent: false,
      canonicalSaved: false,
    });
    try {
      await persist(value, current);
    } catch (error) {
      // A failed journal write may have committed. Discard only after proven absence.
      if (current() && !(await journal(fresh.account)))
        await native()
          .discardDraft({
            contextBinding: fresh.binding,
            fileIds: [staged.fileId],
          })
          .catch(() => undefined);
      throw error;
    }
    return { name: value.reserve.payload.fileName };
  });
}
export async function resumeBackgroundWorkUpload(
  scope: AuthScope = captureAuthScope(),
) {
  return exclusive(async () => {
    const current = () => isAuthScopeCurrent(scope);
    const fresh = await context(scope);
    const value = await journal(fresh.account);
    if (!value) throw new Error("work_upload_not_pending");
    if (fresh.binding !== nativeCaptureBinding(value.account))
      throw new Error("native_work_capture_account_changed");
    const result = await progressBackgroundUpload(value, {
      current,
      fresh: async () => {
        const verified = await currentNativeCaptureContext(scope);
        return verified.account;
      },
      persist: (next) => persist(next, current),
      reserve: (body) =>
        apiFetch(
          "/api/work-hub/file-library/reserve",
          { method: "POST", body: JSON.stringify(body) },
          scope,
        ),
      readTransport: (pending) =>
        native().readUpload({
          jobId: pending.jobId,
          contextBinding: fresh.binding,
        }),
      startTransport: (pending) => {
        const origin = new URL(getApiBase()).origin;
        const uploadUrl = validateNativeUploadDestination(
          pending.reserved!.uploadURL,
          origin,
        );
        return native().startUpload({
          contextBinding: fresh.binding,
          jobId: pending.jobId,
          fileId: pending.staged.fileId,
          uploadUrl,
          canonicalApiOrigin: origin,
          contentType: pending.reserve.payload.contentType,
        });
      },
      readSaved: async (pending) => {
        const detail = z
          .object({ id: z.uuid() })
          .parse(
            await apiFetch(
              `/api/work-hub/file-library/${pending.reserved!.documentId}`,
              {},
              scope,
            ),
          );
        if (detail.id !== pending.reserved!.documentId)
          throw new Error("upload_receipt_mismatch");
        // Exact original saved version; later versions need not be the current one.
        const versions = z
          .array(
            z.object({
              id: z.uuid(),
              fileName: z.string(),
              contentType: z.string(),
              byteSize: z.number().int().positive(),
            }),
          )
          .parse(
            await apiFetch(
              `/api/work-hub/file-library/${pending.reserved!.documentId}/versions`,
              {},
              scope,
            ),
          );
        return versions.some(
          (row) =>
            row.id === pending.reserved!.fileId &&
            row.fileName === pending.reserve.payload.fileName &&
            row.contentType === pending.reserve.payload.contentType &&
            row.byteSize === pending.staged.byteSize,
        );
      },
      finalize: (body) =>
        apiFetch(
          "/api/work-hub/file-library/finalize",
          { method: "POST", body: JSON.stringify(body) },
          scope,
        ),
    });
    if (!current()) throw new Error("native_work_capture_account_changed");
    if (result.state === "saved") {
      await clear(value.account);
      await native()
        .discardDraft({
          contextBinding: fresh.binding,
          fileIds: [value.staged.fileId],
        })
        .catch(() => undefined);
    }
    return { ...result, stagedFileId: value.staged.fileId };
  });
}
export async function cancelBackgroundWorkUpload(
  scope: AuthScope = captureAuthScope(),
) {
  return exclusive(async () => {
    const fresh = await context(scope);
    const value = await journal(fresh.account);
    if (!value) return;
    if (fresh.binding !== nativeCaptureBinding(value.account))
      throw new Error("native_work_capture_account_changed");
    if (
      (value.reserveSent && !value.reserved) ||
      (value.finalizeSent && !value.canonicalSaved)
    )
      throw new Error("upload_result_unresolved");
    const job = await native().readUpload({
      contextBinding: fresh.binding,
      jobId: value.jobId,
    });
    if (job)
      await native().cancelUpload({
        contextBinding: fresh.binding,
        jobId: value.jobId,
      });
    fresh.assertCurrent();
    await clear(value.account);
    await native()
      .discardDraft({
        contextBinding: fresh.binding,
        fileIds: [value.staged.fileId],
      })
      .catch(() => undefined);
  });
}
subscribeToken(() => {
  void NativeCapture?.setContext(null).catch(() => undefined);
});
subscribeUser(() => {
  void NativeCapture?.setContext(null).catch(() => undefined);
});
/** Preserve the selected original scan bytes; OCR text is never substituted for the file. */
export async function beginBackgroundScannedWorkUpload(
  input: {
    page: {
      fileId: string;
      uri: string;
      byteSize: number;
      sha256: string;
      contentType: string;
    };
    name: string;
    owner: { type: "vendor" | "partner"; id: number };
    scope: "personal" | "company" | "channel";
    channelId?: string;
  },
  scope: AuthScope = captureAuthScope(),
) {
  return exclusive(async () => {
    const fresh = await context(scope),
      current = () => isAuthScopeCurrent(scope);
    if (await journal(fresh.account))
      throw new Error("work_upload_pending_exists");
    const staged = {
      fileId: input.page.fileId,
      uri: input.page.uri,
      byteSize: input.page.byteSize,
      sha256: input.page.sha256,
    };
    fresh.assertCurrent();
    const value = BackgroundUploadPendingSchema.parse({
      account: fresh.account,
      staged,
      jobId: nativeUuid(),
      finalizeOperationId: nativeUuid(),
      reserve: {
        operationId: nativeUuid(),
        owner: input.owner,
        context: { kind: "organization", id: input.owner.id },
        payloadVersion: 1,
        expectedVersion: null,
        payload: {
          scope: input.scope,
          ...(input.scope === "channel" ? { channelId: input.channelId } : {}),
          fileName: input.name,
          contentType: input.page.contentType,
          byteSize: staged.byteSize,
          checksumSha256: staged.sha256,
        },
      },
      reserved: null,
      reserveSent: false,
      transportComplete: false,
      finalizeSent: false,
      canonicalSaved: false,
    });
    await persist(value, current);
    return { name: value.reserve.payload.fileName };
  });
}
export async function discardScannedWorkPages(
  fileIds: string[],
  scope: AuthScope = captureAuthScope(),
) {
  const fresh = await context(scope);
  await native().discardDraft({ contextBinding: fresh.binding, fileIds });
  fresh.assertCurrent();
}
