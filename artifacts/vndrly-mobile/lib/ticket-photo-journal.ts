import { z } from "zod/v4";
import NativeCapture from "../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule";
import { apiFetch, getApiBase } from "./api";
import { captureAuthScope, getUser } from "./auth";
import { currentNativeCaptureContext, NativeCaptureAccountSchema } from "./native-capture-context";
import { nativeCaptureBinding } from "./native-capture-context-policy";
import { readNativeTransport, validateNativeUploadDestination } from "./native-work-capture-policy";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";
import { nativeJournalScope } from "./native-operation-journal-runtime";
import { journalScopeKey } from "./native-operation-journal";
import { readAssignedCache } from "./native-assigned-cache";
import { nativeUuid } from "./native-uuid";
import { readNativeOperations } from "./native-operations";
import { createTicketPhotoClient } from "./ticket-photo-association";

const schema = z.object({
  operationId: z.uuid(), ticketId: z.number().int().positive(), account: NativeCaptureAccountSchema,
  source: z.enum(["camera", "library"]), capturedAt: z.string().nullable(), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  staged: z.object({ fileId: z.uuid(), uri: z.string().startsWith("file://"), byteSize: z.number().int().positive().max(10 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  jobId: z.uuid(), grant: z.object({ uploadURL: z.string(), objectPath: z.string() }).nullable(),
  transported: z.boolean(), finalized: z.boolean(),
}).strict();
export type TicketPhotoDraft = z.infer<typeof schema>;
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> { const result = serial.then(work, work); serial = result.catch(() => undefined); return result; }
async function storage() {
  const user = await getUser(); if (!user) throw new Error("native_photo_account_required");
  const store = await getNativeWorkHubQueueStore(), key = `${journalScopeKey(nativeJournalScope(user))}.ticket-photo-drafts`;
  return { user, async read() { return z.array(schema).max(50).parse(JSON.parse(await store.getItem(key) ?? "[]")); }, async write(values: TicketPhotoDraft[]) { await store.setItem(key, JSON.stringify(z.array(schema).max(50).parse(values))); } };
}
export async function readTicketPhotoDrafts(ticketId?: number) {
  const values = await (await storage()).read(); return values.filter(value => ticketId === undefined || value.ticketId === ticketId);
}
/** Local reviewed capture only. This never represents a native request or a saved ticket receipt. */
export async function stageTicketPhoto(ticketId: number, uri: string, contentType: string, source: "camera" | "library", capturedAt: string | null) {
  return exclusive(async () => {
    if (!NativeCapture) throw new Error("native_work_capture_unavailable");
    const context = await currentNativeCaptureContext(captureAuthScope(), true), store = await storage();
    const cached = await readAssignedCache(store.user, `ticket.${ticketId}`);
    if (!cached) throw new Error("native_photo_assigned_snapshot_required");
    await NativeCapture.setContext(context.binding); context.assertCurrent();
    const values = await store.read(); if (values.length >= 50) throw new Error("native_photo_queue_full");
    const staged = await NativeCapture.stageFile({ contextBinding: context.binding, uri }); context.assertCurrent();
    const value = schema.parse({ operationId: nativeUuid(), ticketId, account: context.account, source, capturedAt, contentType, staged, jobId: nativeUuid(), grant: null, transported: false, finalized: false });
    await store.write([...values, value]); return value;
  });
}
export async function resumeTicketPhoto(operationId: string) {
  return exclusive(async () => {
    if (!NativeCapture) throw new Error("native_work_capture_unavailable");
    const scope = captureAuthScope(), context = await currentNativeCaptureContext(scope), store = await storage();
    const values = await store.read(); let value = values.find(item => item.operationId === operationId); if (!value) return "saved";
    if (nativeCaptureBinding(value.account) !== context.binding) throw new Error("native_photo_account_changed");
    const authority = await readNativeOperations(scope);
    if (!authority.tasks?.some(task => task.kind === "ticket" && task.id === String(value!.ticketId))) throw new Error("native_photo_assignment_removed");
    await apiFetch(`/api/tickets/${value.ticketId}`, {}, scope); context.assertCurrent();
    await NativeCapture.setContext(context.binding);
    const persist = async () => { context.assertCurrent(); await store.write(values.map(item => item.operationId === operationId ? value! : item)); };
    if (!value.grant) {
      const grant = await apiFetch<{ uploadURL: string; objectPath: string }>(`/api/native-operations/tickets/${value.ticketId}/photo-upload`, { method: "POST", body: JSON.stringify({ operationId, byteSize: value.staged.byteSize, contentType: value.contentType, checksumSha256: value.staged.sha256 }) }, scope);
      value = { ...value, grant }; await persist();
    }
    if (!value.transported) {
      const raw = await NativeCapture.readUpload({ contextBinding: context.binding, jobId: value.jobId });
      if (!raw || ["failed", "cancelled"].includes((raw as { status?: string }).status ?? "")) {
        {
          const grant = await apiFetch<{ uploadURL: string; objectPath: string }>(`/api/native-operations/tickets/${value.ticketId}/photo-upload`, { method: "POST", body: JSON.stringify({ operationId, byteSize: value.staged.byteSize, contentType: value.contentType, checksumSha256: value.staged.sha256 }) }, scope);
          if (grant.objectPath !== value.grant!.objectPath) throw new Error("native_photo_upload_binding_changed");
          value = { ...value, grant, jobId: nativeUuid() }; await persist();
        }
        const uploadUrl = validateNativeUploadDestination(value.grant!.uploadURL, new URL(getApiBase()).origin);
        await NativeCapture.startUpload({ contextBinding: context.binding, jobId: value.jobId, fileId: value.staged.fileId, uploadUrl, canonicalApiOrigin: new URL(getApiBase()).origin, contentType: value.contentType, wifiOnly: false });
        return "uploading";
      }
      const transport = readNativeTransport(raw, { jobId: value.jobId, fileId: value.staged.fileId, contextBinding: context.binding, sha256: value.staged.sha256 });
      if (transport.status !== "transport_complete") return "uploading";
      value = { ...value, transported: true }; await persist();
    }
    if (!value.finalized) {
      const result = await apiFetch<{ objectPath: string }>("/api/storage/uploads/finalize", { method: "POST", body: JSON.stringify({ objectURL: value.grant!.uploadURL, visibility: "private" }) }, scope);
      if (result.objectPath !== value.grant!.objectPath) throw new Error("native_photo_finalization_unverified");
      value = { ...value, finalized: true }; await persist();
    }
    // Assignment can change during transport. Revalidate again before association.
    const current = await readNativeOperations(scope);
    if (!current.tasks?.some(task => task.kind === "ticket" && task.id === String(value!.ticketId))) throw new Error("native_photo_assignment_removed");
    const receipt = await createTicketPhotoClient(store.user, value.ticketId, async () => ({ objectPath: value!.grant!.objectPath }), operationId).associate();
    if (!receipt || receipt.objectPath !== value.grant!.objectPath || receipt.operationId !== operationId) throw new Error("native_photo_ticket_save_unverified");
    context.assertCurrent(); await store.write(values.filter(item => item.operationId !== operationId));
    await NativeCapture.discardDraft({ contextBinding: context.binding, fileIds: [value.staged.fileId] });
    return "saved";
  });
}
