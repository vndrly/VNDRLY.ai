import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  store: new Map<string, string>(),
  counter: 10,
  current: true,
  account: {
    userId: 9,
    membershipId: 2,
    sessionVersion: 1,
    orgType: "vendor" as const,
    orgId: 4,
  },
  api: vi.fn(),
  stage: vi.fn(),
  start: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => env.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    env.store.set(
      key,
      new TextDecoder().decode(new TextEncoder().encode(value)),
    );
  },
  deleteItemAsync: async (key: string) => {
    env.store.delete(key);
  },
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri = "file:///cache/picked";
    create() {}
    write() {}
    delete() {}
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("./auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  subscribeToken: () => () => {},
  subscribeUser: () => () => {},
}));
vi.mock("./native-capture-context", async () => {
  const policy = await import("./native-capture-context-policy");
  return {
    currentNativeCaptureContext: async () => ({
      account: env.account,
      binding: policy.nativeCaptureBinding(env.account),
      assertCurrent: () => {
        if (!env.current) throw new Error("changed");
      },
    }),
  };
});
vi.mock("./api", () => ({
  apiFetch: env.api,
  getApiBase: () => "https://vndrly.ai",
}));
vi.mock("./native-uuid", () => ({
  nativeUuid: () =>
    `00000000-0000-4000-8000-${String(env.counter++).padStart(12, "0")}`,
}));
vi.mock("../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule", () => ({
  default: {
    getCapabilities: async () => ({ backgroundUpload: true }),
    setContext: async () => {},
    stageFile: env.stage,
    startUpload: env.start,
    readUpload: env.read,
    cancelUpload: env.cancel,
    discardDraft: env.discard,
  },
}));
const file = {
  id: "unused",
  name: "original.png",
  type: "image/png",
  size: 3,
  bytes: new Uint8Array([1, 2, 3]),
};
const staged = {
  fileId: "11111111-1111-4111-8111-111111111111",
  uri: "file:///private/Application Support/original",
  byteSize: 3,
  sha256: "a".repeat(64),
};
const target = {
  owner: { type: "vendor" as const, id: 4 },
  scope: "personal" as const,
};
beforeEach(() => {
  env.store.clear();
  env.counter = 10;
  env.current = true;
  env.account = {
    userId: 9,
    membershipId: 2,
    sessionVersion: 1,
    orgType: "vendor",
    orgId: 4,
  };
  for (const name of [
    "api",
    "stage",
    "start",
    "read",
    "cancel",
    "discard",
  ] as const)
    env[name].mockReset();
  env.stage.mockResolvedValue(staged);
  env.discard.mockResolvedValue(undefined);
  env.cancel.mockResolvedValue(undefined);
  env.read.mockResolvedValue(null);
  env.api.mockImplementation(
    async (_path: string, request?: { body?: string }) => {
      const body = JSON.parse(request?.body ?? "{}");
      return {
        operationId: body.operationId,
        appliedAt: new Date().toISOString(),
        resource: {
          documentId: "22222222-2222-4222-8222-222222222222",
          fileId: "33333333-3333-4333-8333-333333333333",
          objectPath: "/objects/owned",
          uploadURL: `https://vndrly.ai/api/storage/upload/44444444-4444-4444-8444-444444444444?expires=${Date.now() + 60000}&signature=${"a".repeat(64)}`,
        },
      };
    },
  );
  env.start.mockImplementation(async (args) => ({
    jobId: args.jobId,
    fileId: args.fileId,
    contextBinding: args.contextBinding,
    byteSize: 3,
    sha256: staged.sha256,
    status: "uploading",
    httpStatus: null,
    canonicalSaved: false,
  }));
});
it("persists encrypted immutable metadata across module restart and retries exact reserve UUID", async () => {
  let upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  env.api.mockRejectedValueOnce(new Error("dropped"));
  await expect(upload.resumeBackgroundWorkUpload()).rejects.toThrow("dropped");
  const first = env.api.mock.calls[0][1].body;
  vi.resetModules();
  upload = await import("./work-hub-background-upload-native");
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "original.png",
  });
  await upload.resumeBackgroundWorkUpload();
  expect(env.api.mock.calls[1][1].body).toBe(first);
  expect(env.stage).toHaveBeenCalledTimes(1);
  expect(env.start).toHaveBeenCalledTimes(1);
  expect([...env.store.values()].join("")).not.toMatch(
    /bearer|password|token/i,
  );
  expect([...env.store.values()].every((value) => value.length <= 400)).toBe(
    true,
  );
});
it("uses exact owned scan staged ID without trying to import private Application Support URI", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundScannedWorkUpload({
    page: { ...staged, contentType: "image/jpeg" },
    name: "scanned-page-2.jpg",
    ...target,
  });
  expect(env.stage).not.toHaveBeenCalled();
  await upload.resumeBackgroundWorkUpload();
  expect(env.start).toHaveBeenCalledWith(
    expect.objectContaining({
      fileId: staged.fileId,
      contentType: "image/jpeg",
    }),
  );
});
it("cancel before native job exists does not call a nonexistent job and preserves canonical records", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  await upload.cancelBackgroundWorkUpload();
  expect(env.cancel).not.toHaveBeenCalled();
  expect(env.api).not.toHaveBeenCalled();
  expect(env.discard).toHaveBeenCalledWith(
    expect.objectContaining({ fileIds: [staged.fileId] }),
  );
  expect(await upload.readPendingWorkUpload()).toBeNull();
});
it("separates journals by actual server account and restores prior account without cross-account effects", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  env.account = { ...env.account, userId: 10, membershipId: 3 };
  expect(await upload.readPendingWorkUpload()).toBeNull();
  await upload.beginBackgroundWorkUpload({
    file: { ...file, name: "second.png" },
    ...target,
  });
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "second.png",
  });
  env.account = { ...env.account, userId: 9, membershipId: 2 };
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "original.png",
  });
  expect(env.api).not.toHaveBeenCalled();
});
it("keeps a native cancel failure unresolved rather than discarding the journal or original bytes", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  env.read.mockResolvedValue({ jobId: "exists" });
  env.cancel.mockRejectedValue(new Error("unknown"));
  await expect(upload.cancelBackgroundWorkUpload()).rejects.toThrow("unknown");
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "original.png",
  });
  expect(env.discard).not.toHaveBeenCalled();
});

it("preserves Unicode file names through bounded encrypted chunk encoding", async () => {
  const upload = await import("./work-hub-background-upload-native");
  const name = "😀".repeat(110) + ".png";
  await upload.beginBackgroundWorkUpload({
    file: { ...file, name },
    ...target,
  });
  expect(await upload.readPendingWorkUpload()).toMatchObject({ name });
  expect(
    [...env.store.values()].every(
      (value) => new TextEncoder().encode(value).byteLength <= 1600,
    ),
  ).toBe(true);
});

it("refuses cancellation of unresolved reserve and retains exact retry identity", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  env.api.mockRejectedValueOnce(new Error("dropped reserve"));
  await expect(upload.resumeBackgroundWorkUpload()).rejects.toThrow(
    "dropped reserve",
  );
  await expect(upload.cancelBackgroundWorkUpload()).rejects.toThrow(
    "upload_result_unresolved",
  );
  expect(env.cancel).not.toHaveBeenCalled();
  expect(env.discard).not.toHaveBeenCalled();
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "original.png",
  });
});
it("refuses cancellation of unresolved finalize without deleting bytes or exact operation", async () => {
  const upload = await import("./work-hub-background-upload-native");
  await upload.beginBackgroundWorkUpload({ file, ...target });
  env.start.mockImplementation(async (args) => ({
    jobId: args.jobId,
    fileId: args.fileId,
    contextBinding: args.contextBinding,
    byteSize: 3,
    sha256: staged.sha256,
    status: "transport_complete",
    httpStatus: 204,
    canonicalSaved: false,
  }));
  const initial = env.api.getMockImplementation()!;
  env.api.mockImplementation(async (path, request) => {
    if (path.endsWith("/finalize")) throw new Error("dropped finalize");
    return initial(path, request);
  });
  await expect(upload.resumeBackgroundWorkUpload()).rejects.toThrow(
    "dropped finalize",
  );
  await expect(upload.cancelBackgroundWorkUpload()).rejects.toThrow(
    "upload_result_unresolved",
  );
  expect(env.cancel).not.toHaveBeenCalled();
  expect(env.discard).not.toHaveBeenCalled();
  expect(await upload.readPendingWorkUpload()).toMatchObject({
    name: "original.png",
    transported: true,
  });
});
