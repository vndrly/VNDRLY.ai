import { describe, expect, it, vi } from "vitest";
import {
  progressBackgroundUpload,
  type BackgroundUploadPending,
} from "./work-hub-background-upload";
import { nativeCaptureBinding } from "./native-capture-context-policy";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
function fixture(): BackgroundUploadPending {
  return {
    account: {
      userId: 9,
      membershipId: 2,
      sessionVersion: 1,
      orgType: "vendor",
      orgId: 4,
    },
    staged: {
      fileId: ids[0],
      uri: "file:///private/original",
      byteSize: 3,
      sha256: "a".repeat(64),
    },
    jobId: ids[1],
    finalizeOperationId: ids[2],
    reserve: {
      operationId: ids[3],
      owner: { type: "vendor", id: 4 },
      context: { kind: "organization", id: 4 },
      payloadVersion: 1,
      expectedVersion: null,
      payload: {
        scope: "personal",
        fileName: "synthetic.png",
        contentType: "image/png",
        byteSize: 3,
        checksumSha256: "a".repeat(64),
      },
    },
    reserved: null,
    reserveSent: false,
    transportComplete: false,
    finalizeSent: false,
    canonicalSaved: false,
  };
}
function setup() {
  let stored = fixture();
  let current = true;
  const reserved = {
    documentId: ids[4],
    fileId: ids[3],
    objectPath: "/objects/owned",
    uploadURL: "https://vndrly.ai/api/storage/upload/id",
  };
  const transport = (
    status = "transport_complete",
    httpStatus: number | null = 204,
  ) => ({
    jobId: stored.jobId,
    fileId: stored.staged.fileId,
    contextBinding: nativeCaptureBinding(stored.account),
    status,
    httpStatus,
    byteSize: 3,
    sha256: stored.staged.sha256,
    canonicalSaved: false,
  });
  const deps = {
    current: () => current,
    fresh: vi.fn(async () => stored.account),
    persist: vi.fn(async (value: BackgroundUploadPending) => {
      stored = structuredClone(value);
    }),
    reserve: vi.fn(async () => ({
      operationId: stored.reserve.operationId,
      appliedAt: new Date().toISOString(),
      resource: reserved,
    })),
    readTransport: vi.fn(async () => null as unknown),
    startTransport: vi.fn(async () => transport()),
    readSaved: vi.fn(async () => true),
    finalize: vi.fn(async () => ({
      operationId: stored.finalizeOperationId,
      appliedAt: new Date().toISOString(),
      resource: {
        id: reserved.documentId,
        orgType: "vendor",
        orgId: 4,
        createdBy: 9,
        data: {
          currentFileId: reserved.fileId,
          contentType: "image/png",
          byteSize: 3,
          versions: [reserved.fileId],
        },
      },
    })),
  };
  return {
    deps,
    transport,
    get: () => stored,
    revoke: () => {
      current = false;
    },
  };
}
describe("persistent Work Hub background transport", () => {
  it("retains a proven finalize when visibility fails and resumes by read only", async () => {
    const io = setup();
    io.deps.readSaved.mockRejectedValueOnce(new Error("denied"));
    await expect(progressBackgroundUpload(io.get(), io.deps)).rejects.toThrow(
      "denied",
    );
    expect(io.get().canonicalSaved).toBe(true);
    io.deps.readSaved.mockResolvedValue(true);
    expect(await progressBackgroundUpload(io.get(), io.deps)).toMatchObject({
      state: "saved",
    });
    expect(io.deps.finalize).toHaveBeenCalledTimes(1);
    expect(io.deps.reserve).toHaveBeenCalledTimes(1);
  });
  it("journals immutable reserve before send and retries exactly after a dropped response", async () => {
    const io = setup();
    io.deps.reserve.mockRejectedValueOnce(new Error("dropped"));
    await expect(progressBackgroundUpload(io.get(), io.deps)).rejects.toThrow(
      "dropped",
    );
    expect(io.get().reserveSent).toBe(true);
    expect(io.deps.persist).toHaveBeenCalledBefore(io.deps.reserve);
    await progressBackgroundUpload(io.get(), io.deps);
    expect(io.deps.reserve.mock.calls[0]).toEqual(
      io.deps.reserve.mock.calls[1],
    );
    expect(io.get().reserve.operationId).toBe(ids[3]);
  });
  it("queued bytes remain transport-only and never finalize", async () => {
    const io = setup();
    io.deps.startTransport.mockResolvedValue(io.transport("uploading", null));
    expect(await progressBackgroundUpload(io.get(), io.deps)).toMatchObject({
      state: "uploading",
    });
    expect(io.deps.finalize).not.toHaveBeenCalled();
    expect(io.get().canonicalSaved).toBe(false);
  });
  it("recovers the exact native job after restart, then persists finalize before canonical save", async () => {
    const io = setup();
    io.deps.readTransport.mockResolvedValue(io.transport());
    expect(await progressBackgroundUpload(io.get(), io.deps)).toMatchObject({
      state: "saved",
    });
    expect(io.deps.startTransport).not.toHaveBeenCalled();
    expect(io.deps.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: ids[2],
        payload: { id: ids[4], fileId: ids[3] },
      }),
    );
    expect(io.get().canonicalSaved).toBe(true);
  });
  it("reconciles unknown finalize through exact authorized saved version without another POST", async () => {
    const io = setup();
    io.deps.finalize.mockRejectedValueOnce(new Error("unknown"));
    await expect(progressBackgroundUpload(io.get(), io.deps)).rejects.toThrow();
    expect(io.get().finalizeSent).toBe(true);
    io.deps.readSaved.mockResolvedValue(true);
    expect(await progressBackgroundUpload(io.get(), io.deps)).toMatchObject({
      state: "saved",
    });
    expect(io.deps.finalize).toHaveBeenCalledTimes(1);
  });
  it("refuses account/SV changes and does not finalize after current context revocation", async () => {
    const io = setup();
    io.deps.fresh.mockResolvedValue({ ...io.get().account, sessionVersion: 2 });
    await expect(progressBackgroundUpload(io.get(), io.deps)).rejects.toThrow();
    expect(io.deps.reserve).not.toHaveBeenCalled();
    const other = setup();
    other.deps.startTransport.mockImplementation(async () => {
      other.revoke();
      return other.transport();
    });
    await expect(
      progressBackgroundUpload(other.get(), other.deps),
    ).rejects.toThrow();
    expect(other.deps.finalize).not.toHaveBeenCalled();
  });
  it("rejects substituted byte hash or native successful status other than exact204", async () => {
    for (const raw of [{ sha256: "b".repeat(64) }, { httpStatus: 200 }]) {
      const io = setup();
      io.deps.startTransport.mockResolvedValue({ ...io.transport(), ...raw });
      await expect(
        progressBackgroundUpload(io.get(), io.deps),
      ).rejects.toThrow();
      expect(io.deps.finalize).not.toHaveBeenCalled();
    }
  });
});

it("rejects foreign personal/company owner but preserves explicit channel-owner canonical authorization", async () => {
  const foreign = fixture();
  foreign.reserve.owner.id = 5;
  foreign.reserve.context.id = 5;
  const io = setup();
  await expect(progressBackgroundUpload(foreign, io.deps)).rejects.toThrow();
  expect(io.deps.reserve).not.toHaveBeenCalled();
  const channel = fixture();
  channel.reserve.owner.id = 5;
  channel.reserve.context.id = 5;
  channel.reserve.payload.scope = "channel";
  channel.reserve.payload.channelId = ids[4];
  io.deps.reserve.mockRejectedValue(
    new Error("canonical channel permission denied"),
  );
  await expect(progressBackgroundUpload(channel, io.deps)).rejects.toThrow(
    "canonical channel permission denied",
  );
  expect(io.deps.reserve).toHaveBeenCalledWith(channel.reserve);
  expect(io.deps.startTransport).not.toHaveBeenCalled();
});
