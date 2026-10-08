import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  rows: new Map<string, string>(), api: vi.fn(), request: vi.fn(), respond: vi.fn(), associate: vi.fn(),
  stage: vi.fn(), read: vi.fn(), start: vi.fn(), discard: vi.fn(), cancel: vi.fn(), current: true, saved: false,
}));
const id = "00000000-0000-4000-8000-000000000001", fileId = "00000000-0000-4000-8000-000000000002", deviceId = "00000000-0000-4000-8000-000000000003", jobId = "00000000-0000-4000-8000-000000000004";
const account = { userId: 1, membershipId: 2, sessionVersion: 1, orgType: "vendor" as const, orgId: 3 }, binding = '["vndrly-work-capture",1,2,"vendor",3,1]', path = "/objects/uploads/00000000-0000-4000-8000-000000000005";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-crypto", () => ({}));
vi.mock("./api", () => ({ apiFetch: env.api, getApiBase: () => "https://example.test" }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({ generation: 1 }), getUser: async () => ({ id: 1, activeMembershipId: 2, vendorId: 3 }), isAuthScopeCurrent: () => env.current }));
vi.mock("./native-capture-context", () => ({ currentNativeCaptureContext: async () => ({ account, binding, assertCurrent() { if (!env.current) throw Error("account changed"); } }) }));
vi.mock("./deviceId", () => ({ getDeviceId: async () => deviceId }));
vi.mock("./native-uuid", () => ({ nativeUuid: () => jobId }));
vi.mock("./native-operation-journal-runtime", () => ({ nativeJournalScope: () => ({ userId: 1, membershipId: 2, orgType: "vendor", orgId: 3 }) }));
vi.mock("./work-hub-queue-native", () => ({ getNativeWorkHubQueueStore: async () => ({ getItem: async (key: string) => env.rows.get(key) ?? null, setItem: async (key: string, value: string) => { env.rows.set(key, value); } }) }));
vi.mock("./native-operations", () => ({ readNativeRequest: env.request, respondNativeRequest: env.respond }));
vi.mock("./ticket-photo-association", () => ({ createTicketPhotoClient: () => ({ associate: env.associate }) }));
vi.mock("../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule", () => ({ default: { setContext: async () => {}, stageFile: env.stage, readUpload: env.read, startUpload: env.start, discardDraft: env.discard, cancelUpload: env.cancel } }));
import { beginRequestedPhoto, readPendingRequestedPhotos, resumeRequestedPhoto, setRequestedPhotoTransfer } from "./requested-photo-upload";
const request = () => ({ id, kind: "photo" as const, ticketId: 9, purpose: "Reviewed equipment photo", expiresAt: new Date(Date.now() + 60_000).toISOString(), deviceId, bindingVersion: 7, state: env.saved ? "saved" : "opened", allowLibrary: false });
beforeEach(() => {
  vi.clearAllMocks(); env.rows.clear(); env.current = true; env.saved = false;
  env.stage.mockResolvedValue({ fileId, uri: "file:///protected/source.jpg", byteSize: 100, sha256: "a".repeat(64) });
  env.request.mockImplementation(async () => request()); env.read.mockResolvedValue(null);
  env.api.mockImplementation(async (url: string) => url.endsWith("photo-upload") ? { uploadURL: `https://example.test/api/storage/upload/00000000-0000-4000-8000-000000000005?expires=${Date.now() + 60_000}&signature=${"b".repeat(64)}`, objectPath: path } : { objectPath: path });
  env.associate.mockResolvedValue({ noteId: 12, operationId: id, objectPath: path });
  env.respond.mockImplementation(async () => { env.saved = true; });
});
it("retains exact reviewed file, original key, checksum and supplied time until canonical association and request readback", async () => {
  const time = "2026-10-08T01:00:00Z"; await beginRequestedPhoto(request(), "file:///camera.jpg", "image/jpeg", "camera", time);
  expect(await resumeRequestedPhoto(id)).toEqual({ state: "uploading" });
  expect(env.associate).not.toHaveBeenCalled(); expect(env.discard).not.toHaveBeenCalled();
  const photo = (await readPendingRequestedPhotos())[0];
  expect(photo).toMatchObject({ requestId: id, capturedAt: time, staged: { fileId, sha256: "a".repeat(64) } });
  env.read.mockResolvedValue({ jobId, fileId, contextBinding: binding, status: "transport_complete", httpStatus: 204, byteSize: 100, sha256: "a".repeat(64), canonicalSaved: false });
  expect(await resumeRequestedPhoto(id)).toEqual({ state: "saved" });
  expect(env.respond.mock.calls[0][1]).toMatchObject({ operationId: id, objectPath: path, photoCapturedAt: time });
  expect(await readPendingRequestedPhotos()).toEqual([]); expect(env.discard).toHaveBeenCalled();
});
it("keeps original pending file when transport fingerprint or canonical save is unverified", async () => {
  await beginRequestedPhoto(request(), "file:///camera.jpg", "image/jpeg", "camera"); await resumeRequestedPhoto(id);
  env.read.mockResolvedValue({ jobId, fileId, contextBinding: binding, status: "transport_complete", httpStatus: 204, byteSize: 100, sha256: "f".repeat(64), canonicalSaved: false });
  await expect(resumeRequestedPhoto(id)).rejects.toThrow("context_changed"); expect(await readPendingRequestedPhotos()).toHaveLength(1); expect(env.associate).not.toHaveBeenCalled();
});
it("pauses without discarding bytes and refuses a changed account before touching the transfer", async () => {
  await beginRequestedPhoto(request(), "file:///camera.jpg", "image/jpeg", "camera"); await resumeRequestedPhoto(id);
  await setRequestedPhotoTransfer(id, { paused: true, wifiOnly: true });
  expect(env.cancel).toHaveBeenCalled(); expect((await readPendingRequestedPhotos())[0]).toMatchObject({ paused: true, wifiOnly: true }); expect(env.discard).not.toHaveBeenCalled();
  expect(await resumeRequestedPhoto(id)).toEqual({ state: "pending" });
  await setRequestedPhotoTransfer(id, { paused: false }); env.current = false;
  await expect(resumeRequestedPhoto(id)).rejects.toThrow("account changed");
  expect(env.start).toHaveBeenCalledTimes(1); expect(await readPendingRequestedPhotos()).toHaveLength(1);
});
it("recovers a lost saved response by canonical readback without repeating the ticket association", async () => {
  await beginRequestedPhoto(request(), "file:///camera.jpg", "image/jpeg", "camera"); await resumeRequestedPhoto(id);
  env.read.mockResolvedValue({ jobId, fileId, contextBinding: binding, status: "transport_complete", httpStatus: 204, byteSize: 100, sha256: "a".repeat(64), canonicalSaved: false });
  env.respond.mockImplementationOnce(async () => { env.saved = true; throw Error("lost response"); });
  await expect(resumeRequestedPhoto(id)).rejects.toThrow("lost response"); expect(await readPendingRequestedPhotos()).toHaveLength(1);
  expect(await resumeRequestedPhoto(id)).toEqual({ state: "saved" }); expect(env.associate).toHaveBeenCalledTimes(1); expect(await readPendingRequestedPhotos()).toEqual([]);
});
