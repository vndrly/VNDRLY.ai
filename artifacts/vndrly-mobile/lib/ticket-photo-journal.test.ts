import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ rows: new Map<string, string>(), api: vi.fn(), stage: vi.fn(), read: vi.fn(), start: vi.fn(), discard: vi.fn(), associate: vi.fn(), allowed: true }));
const operationId = "00000000-0000-4000-8000-000000000001", fileId = "00000000-0000-4000-8000-000000000002";
const account = { userId: 1, membershipId: 2, sessionVersion: 1, orgType: "vendor", orgId: 3 }, binding = '["vndrly-work-capture",1,2,"vendor",3,1]', objectPath = "/objects/uploads/00000000-0000-4000-8000-000000000003";
vi.mock("./api", () => ({ apiFetch: env.api, getApiBase: () => "https://example.test" }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({ generation: 1 }), getUser: async () => ({ id: 1, activeMembershipId: 2, vendorId: 3 }) }));
vi.mock("./native-capture-context", async () => ({ NativeCaptureAccountSchema: (await import("./native-capture-context-policy")).NativeCaptureAccountSchema, currentNativeCaptureContext: async () => ({ account, binding, assertCurrent() {} }) }));
vi.mock("./native-uuid", () => ({ nativeUuid: () => operationId }));
vi.mock("./native-assigned-cache", () => ({ readAssignedCache: async () => ({ value: {}, capturedAt: Date.now() }) }));
vi.mock("./native-operation-journal-runtime", () => ({ nativeJournalScope: () => ({ userId: 1, membershipId: 2, orgType: "vendor", orgId: 3 }) }));
vi.mock("./work-hub-queue-native", () => ({ getNativeWorkHubQueueStore: async () => ({ getItem: async (key: string) => env.rows.get(key) ?? null, setItem: async (key: string, value: string) => { env.rows.set(key, value); } }) }));
vi.mock("./native-operations", () => ({ readNativeOperations: async () => ({ tasks: env.allowed ? [{ kind: "ticket", id: "9" }] : [] }) }));
vi.mock("./ticket-photo-association", () => ({ createTicketPhotoClient: () => ({ associate: env.associate }) }));
vi.mock("../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule", () => ({ default: { setContext: async () => {}, stageFile: env.stage, readUpload: env.read, startUpload: env.start, discardDraft: env.discard } }));
import { readTicketPhotoDrafts, resumeTicketPhoto, stageTicketPhoto } from "./ticket-photo-journal";
beforeEach(() => {
  vi.clearAllMocks(); env.rows.clear(); env.allowed = true;
  env.stage.mockResolvedValue({ fileId, uri: "file:///protected/original.jpg", byteSize: 100, sha256: "a".repeat(64) }); env.read.mockResolvedValue(null);
  env.api.mockImplementation(async (path: string) => path.endsWith("photo-upload") ? { objectPath, uploadURL: `https://example.test/api/storage/upload/00000000-0000-4000-8000-000000000003?expires=${Date.now() + 60000}&signature=${"b".repeat(64)}` } : { objectPath });
  env.associate.mockResolvedValue({ operationId, objectPath, noteId: 12 });
});
it("preserves original reviewed bytes and operation across retries and reads exact canonical ticket receipt before cleanup", async () => {
  await stageTicketPhoto(9, "file:///camera.jpg", "image/jpeg", "camera", "2026-10-08T02:00:00Z");
  expect(await resumeTicketPhoto(operationId)).toBe("uploading");
  expect(env.associate).not.toHaveBeenCalled(); expect(env.discard).not.toHaveBeenCalled();
  const draft = (await readTicketPhotoDrafts())[0]; expect(draft).toMatchObject({ operationId, staged: { fileId, sha256: "a".repeat(64) } });
  env.read.mockResolvedValue({ jobId: operationId, fileId, contextBinding: binding, status: "transport_complete", httpStatus: 204, byteSize: 100, sha256: "a".repeat(64), canonicalSaved: false });
  expect(await resumeTicketPhoto(operationId)).toBe("saved"); expect(await readTicketPhotoDrafts()).toEqual([]); expect(env.discard).toHaveBeenCalled();
  expect(env.api.mock.calls.every(call => !String(call[0]).includes("/requests/"))).toBe(true);
});
it("retains original file after assignment removal and never obtains a grant or associates", async () => {
  await stageTicketPhoto(9, "file:///camera.jpg", "image/jpeg", "camera", null); env.allowed = false;
  await expect(resumeTicketPhoto(operationId)).rejects.toThrow("assignment_removed");
  expect(env.api).not.toHaveBeenCalled(); expect(env.associate).not.toHaveBeenCalled(); expect(await readTicketPhotoDrafts()).toHaveLength(1);
});
it("refuses path replacement on renewal and retains the original pending draft", async () => {
  await stageTicketPhoto(9, "file:///camera.jpg", "image/jpeg", "camera", null); await resumeTicketPhoto(operationId);
  env.read.mockResolvedValue({ status: "failed" }); env.api.mockImplementation(async (path: string) => path.endsWith("photo-upload") ? { objectPath: "/objects/replaced", uploadURL: "" } : {});
  await expect(resumeTicketPhoto(operationId)).rejects.toThrow("binding_changed"); expect((await readTicketPhotoDrafts())[0].grant?.objectPath).toBe(objectPath); expect(env.stage).toHaveBeenCalledTimes(1);
});
