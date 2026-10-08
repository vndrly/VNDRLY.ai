import { z } from "zod/v4";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import type { ImagePickerAsset } from "expo-image-picker";
import NativeCapture from "../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule";
import { apiFetch, getApiBase } from "./api";
import { captureAuthScope, getUser, isAuthScopeCurrent } from "./auth";
import { currentNativeCaptureContext } from "./native-capture-context";
import { nativeCaptureBinding, NativeCaptureAccountSchema } from "./native-capture-context-policy";
import { readNativeTransport, validateNativeUploadDestination } from "./native-work-capture-policy";
import { getDeviceId } from "./deviceId";
import { nativeUuid } from "./native-uuid";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";
import { nativeJournalScope } from "./native-operation-journal-runtime";
import { journalScopeKey } from "./native-operation-journal";
import { readNativeRequest, respondNativeRequest } from "./native-operations";
import { requestIsActionable, type NativeDeviceRequest } from "./native-operations-policy";
import { createTicketPhotoClient } from "./ticket-photo-association";

const pendingSchema = z.object({
  requestId: z.uuid(), ticketId: z.number().int().positive(), account: NativeCaptureAccountSchema,
  deviceId: z.uuid(), bindingVersion: z.number().int().nonnegative(), source: z.enum(["camera", "library"]), capturedAt: z.string().nullable(),
  staged: z.object({ fileId: z.uuid(), uri: z.string().startsWith("file://"), byteSize: z.number().int().positive().max(10 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), jobId: z.uuid(),
  grant: z.object({ uploadURL: z.string(), objectPath: z.string() }).nullable(),
  transportComplete: z.boolean(), storageFinalized: z.boolean(), paused: z.boolean(), wifiOnly: z.boolean(),
}).strict();
export type PendingRequestedPhoto = z.infer<typeof pendingSchema>;
const locks = new Map<string, Promise<unknown>>();
async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const task = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(work); locks.set(key, task);
  try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
async function storage() {
  const user = await getUser(); if (!user) throw new Error("native_photo_account_required");
  const store = await getNativeWorkHubQueueStore(), prefix = `${journalScopeKey(nativeJournalScope(user))}.photo`, registry = `${prefix}.registry`;
  const ids = () => store.getItem(registry).then(raw => z.array(z.uuid()).max(50).parse(JSON.parse(raw ?? "[]")));
  return {
    async read(id: string) { const raw = await store.getItem(`${prefix}.${id}`); return raw ? pendingSchema.parse(JSON.parse(raw)) : null; },
    async write(value: PendingRequestedPhoto) { const parsed = pendingSchema.parse(value); await exclusive(registry, async () => { const values = await ids(); if (!values.includes(parsed.requestId) && values.length >= 50) throw new Error("native_photo_queue_full"); await store.setItem(`${prefix}.${parsed.requestId}`, JSON.stringify(parsed)); if (!values.includes(parsed.requestId)) await store.setItem(registry, JSON.stringify([...values, parsed.requestId])); }); },
    async clear(id: string) { await exclusive(registry, async () => { const values = await ids(); await store.setItem(registry, JSON.stringify(values.filter(value => value !== id))); await store.setItem(`${prefix}.${id}`, ""); }); },
    ids,
  };
}
function native() { if (Platform.OS !== "ios" || !NativeCapture) throw new Error("native_requested_photo_unavailable"); return NativeCapture; }
export function requestedPhotoBackgroundAvailable() { return Platform.OS === "ios" && typeof NativeCapture?.startUpload === "function"; }
/** Unsupported native binaries retain a reviewed foreground save with the same canonical binding. */
export async function saveRequestedPhotoForeground(request: NativeDeviceRequest, asset: ImagePickerAsset, source: "camera" | "library", capturedAt: string | null = null) {
  const scope = captureAuthScope(), user = await getUser(), deviceId = await getDeviceId();
  if (!user) throw new Error("native_photo_account_required");
  const current = await readNativeRequest(request.id, scope);
  if (!current.ticketId || !requestIsActionable(current) || current.deviceId !== deviceId || (source === "library" && !current.allowLibrary)) throw new Error("native_photo_request_unavailable");
  const client = createTicketPhotoClient(user, current.ticketId, async () => {
    const bytes = await fetch(asset.uri).then(response => response.arrayBuffer());
    if (!isAuthScopeCurrent(scope) || !bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new Error("native_photo_size_invalid");
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    const checksumSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const grant = await apiFetch<{ uploadURL: string; objectPath: string }>(`/api/native-operations/requests/${request.id}/photo-upload`, { method: "POST", body: JSON.stringify({ deviceId, bindingVersion: current.bindingVersion, contentType: asset.mimeType || "image/jpeg", byteSize: bytes.byteLength, checksumSha256 }) }, scope);
    const destination = validateNativeUploadDestination(grant.uploadURL, new URL(getApiBase()).origin);
    const uploaded = await fetch(destination, { method: "PUT", headers: { "content-type": asset.mimeType || "image/jpeg" }, body: bytes });
    if (!uploaded.ok || !isAuthScopeCurrent(scope)) throw new Error("native_photo_transport_unverified");
    const saved = await apiFetch<{ objectPath: string }>("/api/storage/uploads/finalize", { method: "POST", body: JSON.stringify({ objectURL: grant.uploadURL, visibility: "private" }) }, scope);
    if (saved.objectPath !== grant.objectPath) throw new Error("native_photo_finalization_unverified");
    return saved;
  }, request.id);
  const receipt = await client.associate();
  if (!receipt) return;
  await respondNativeRequest(request.id, { state: "saved", noteId: receipt.noteId, operationId: receipt.operationId, objectPath: receipt.objectPath, photoSource: source, ...(capturedAt ? { photoCapturedAt: capturedAt } : {}) }, scope, { deviceId, bindingVersion: current.bindingVersion! });
  const saved = await readNativeRequest(request.id, scope);
  if (saved.state !== "saved") throw new Error("native_photo_request_save_unverified");
}
export async function beginRequestedPhoto(request: NativeDeviceRequest, uri: string, contentType: string, source: "camera" | "library", capturedAt: string | null = null) {
  return exclusive(request.id, async () => {
    const scope = captureAuthScope(), context = await currentNativeCaptureContext(scope), deviceId = await getDeviceId(), store = await storage();
    if (await store.read(request.id)) return;
    const current = await readNativeRequest(request.id, scope);
    if (!current.ticketId || !requestIsActionable(current) || current.deviceId !== deviceId || (source === "library" && !current.allowLibrary)) throw new Error("native_photo_request_unavailable");
    await native().setContext(context.binding); context.assertCurrent();
    const staged = await native().stageFile({ contextBinding: context.binding, uri }); context.assertCurrent();
    const value = pendingSchema.parse({ requestId: current.id, ticketId: current.ticketId, account: context.account, deviceId, bindingVersion: current.bindingVersion, source, capturedAt, staged, contentType, jobId: nativeUuid(), grant: null, transportComplete: false, storageFinalized: false, paused: false, wifiOnly: false });
    await store.write(value); context.assertCurrent();
  });
}
export async function readPendingRequestedPhotos() {
  const store = await storage(), values = await Promise.all((await store.ids()).map(id => store.read(id)));
  return values.filter((value): value is PendingRequestedPhoto => value !== null);
}
export async function readRequestedPhotoPercentage(value: PendingRequestedPhoto) {
  if (value.transportComplete) return 100;
  if (!value.grant || !NativeCapture) return 0;
  const context = await currentNativeCaptureContext(captureAuthScope(), true);
  if (nativeCaptureBinding(value.account) !== context.binding) throw new Error("native_photo_account_changed");
  await NativeCapture.setContext(context.binding);
  const raw = await NativeCapture.readUpload({ contextBinding: context.binding, jobId: value.jobId });
  if (!raw) return 0;
  const transport = readNativeTransport(raw, { jobId: value.jobId, fileId: value.staged.fileId, contextBinding: context.binding, sha256: value.staged.sha256 });
  return transport.bytesSent === undefined ? null : Math.min(100, Math.floor(transport.bytesSent * 100 / value.staged.byteSize));
}
export async function setRequestedPhotoTransfer(id: string, options: { paused?: boolean; wifiOnly?: boolean }) {
  return exclusive(id, async () => {
    const store = await storage(), value = await store.read(id); if (!value) return;
    if (options.paused && value.grant && !value.transportComplete) {
      const context = await currentNativeCaptureContext(); await native().setContext(context.binding);
      await native().cancelUpload({ contextBinding: context.binding, jobId: value.jobId });
    }
    await store.write({ ...value, ...options, ...(options.paused && !value.transportComplete ? { jobId: nativeUuid() } : {}) });
  });
}
export async function resumeRequestedPhoto(id: string) {
  return exclusive(id, async () => {
    const scope = captureAuthScope(), context = await currentNativeCaptureContext(scope), store = await storage();
    let value = await store.read(id); if (!value || value.paused) return { state: "pending" as const };
    if (nativeCaptureBinding(value.account) !== context.binding || value.deviceId !== await getDeviceId()) throw new Error("native_photo_account_changed");
    const request = await readNativeRequest(id, scope);
    if (request.ticketId !== value.ticketId) throw new Error("native_photo_ticket_changed");
    await native().setContext(context.binding); context.assertCurrent();
    if (request.state === "saved") { await store.clear(id); await native().discardDraft({ contextBinding: context.binding, fileIds: [value.staged.fileId] }); return { state: "saved" as const }; }
    if (!requestIsActionable(request) && request.state !== "upload-in-progress" && !value.grant) return { state: "expired" as const };
    await native().setContext(context.binding); context.assertCurrent();
    if (!value.grant) {
      const grant = await apiFetch<{ uploadURL: string; objectPath: string }>(`/api/native-operations/requests/${id}/photo-upload`, { method: "POST", body: JSON.stringify({ deviceId: value.deviceId, bindingVersion: value.bindingVersion, contentType: value.contentType, byteSize: value.staged.byteSize, checksumSha256: value.staged.sha256 }) }, scope);
      value = { ...value, grant }; await store.write(value); context.assertCurrent();
    }
    if (!value.transportComplete) {
      const transport = await native().readUpload({ contextBinding: context.binding, jobId: value.jobId });
      if (!transport || transport.status === "failed" || transport.status === "cancelled") {
        if (transport) {
          const grant = await apiFetch<{ uploadURL: string; objectPath: string }>(`/api/native-operations/requests/${id}/photo-upload`, { method: "POST", body: JSON.stringify({ deviceId: value.deviceId, bindingVersion: value.bindingVersion, contentType: value.contentType, byteSize: value.staged.byteSize, checksumSha256: value.staged.sha256 }) }, scope);
          if (grant.objectPath !== value.grant!.objectPath) throw new Error("native_photo_upload_binding_changed");
          value = { ...value, grant, jobId: nativeUuid() }; await store.write(value);
        }
        const uploadUrl = validateNativeUploadDestination(value.grant!.uploadURL, new URL(getApiBase()).origin);
        await native().startUpload({ contextBinding: context.binding, jobId: value.jobId, fileId: value.staged.fileId, uploadUrl, canonicalApiOrigin: new URL(getApiBase()).origin, contentType: value.contentType, wifiOnly: value.wifiOnly });
        return { state: "uploading" as const };
      }
      const verified = readNativeTransport(transport, { jobId: value.jobId, fileId: value.staged.fileId, contextBinding: context.binding, sha256: value.staged.sha256 });
      if (verified.status !== "transport_complete") return { state: "uploading" as const };
      value = { ...value, transportComplete: true }; await store.write(value);
    }
    if (!value.storageFinalized) {
      const finalized = await apiFetch<{ objectPath: string }>("/api/storage/uploads/finalize", { method: "POST", body: JSON.stringify({ objectURL: value.grant!.uploadURL, visibility: "private" }) }, scope);
      if (finalized.objectPath !== value.grant!.objectPath) throw new Error("native_photo_finalization_unverified");
      value = { ...value, storageFinalized: true }; await store.write(value);
    }
    const user = await getUser(); context.assertCurrent(); if (!user) throw new Error("native_photo_account_changed");
    const receipt = await createTicketPhotoClient(user, value.ticketId, async () => ({ objectPath: value!.grant!.objectPath }), id).associate();
    if (!receipt || !isAuthScopeCurrent(scope)) throw new Error("native_photo_ticket_save_unverified");
    await respondNativeRequest(id, { state: "saved", noteId: receipt.noteId, operationId: receipt.operationId, objectPath: receipt.objectPath, photoSource: value.source, ...(value.capturedAt ? { photoCapturedAt: value.capturedAt } : {}) }, scope, { deviceId: value.deviceId, bindingVersion: value.bindingVersion });
    const saved = await readNativeRequest(id, scope);
    if (saved.state !== "saved") return { state: "pending" as const };
    await store.clear(id); context.assertCurrent();
    await native().discardDraft({ contextBinding: context.binding, fileIds: [value.staged.fileId] });
    return { state: "saved" as const };
  });
}
