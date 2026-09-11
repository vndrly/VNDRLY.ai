import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  cameraPermission: "granted",
  libraryPermission: "granted",
  camera: vi.fn(),
  library: vi.fn(),
  pick: vi.fn(),
  raw: vi.fn(),
  shareAvailable: vi.fn(),
  share: vi.fn(),
  files: new Map<string, { bytes: Uint8Array; name: string; type: string; deleted: boolean }>(),
  ids: [] as string[],
}));

vi.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  requestCameraPermissionsAsync: async () => ({ status: env.cameraPermission }),
  requestMediaLibraryPermissionsAsync: async () => ({ status: env.libraryPermission }),
  launchCameraAsync: env.camera,
  launchImageLibraryAsync: env.library,
}));

vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    name: string;
    type: string;
    size: number;
    exists = true;
    constructor(...parts: any[]) {
      this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/").replace(/\/+/g, "/");
      const existing = env.files.get(this.uri);
      this.name = existing?.name ?? this.uri.split("/").at(-1) ?? "file";
      this.type = existing?.type ?? "";
      this.size = existing?.bytes.length ?? 0;
    }
    async bytes() {
      const value = env.files.get(this.uri);
      if (!value) throw new Error("unreadable");
      return value.bytes;
    }
    create() { env.files.set(this.uri, { bytes: new Uint8Array(), name: this.name, type: this.type, deleted: false }); }
    write(bytes: Uint8Array) { env.files.set(this.uri, { bytes, name: this.name, type: this.type, deleted: false }); }
    delete() { const value = env.files.get(this.uri); if (value) value.deleted = true; }
    static pickFileAsync = env.pick;
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/").replace(/([^:])\/{2,}/g, "$1/"); }
    create() {}
  }
  return { File, Directory, Paths: { cache: { uri: "file:///cache" }, document: { uri: "file:///document" } } };
});

vi.mock("expo-sharing", () => ({
  isAvailableAsync: env.shareAvailable,
  shareAsync: env.share,
}));
vi.mock("@/lib/api", () => ({ apiFetchRaw: env.raw }));
vi.mock("@/lib/native-uuid", () => ({ nativeUuid: () => env.ids.shift()! }));

import {
  MeetingFileFailure,
  downloadAndShareMeetingFile,
  downloadAndShareMeetingReplayFile,
  pickMeetingFile,
  persistMeetingFileForOffline,
  uploadMeetingFile,
} from "./meeting-files";

const authScope = { generation: 4 } as any;

beforeEach(() => {
  env.cameraPermission = "granted";
  env.libraryPermission = "granted";
  env.camera.mockReset();
  env.library.mockReset();
  env.pick.mockReset();
  env.raw.mockReset();
  env.shareAvailable.mockReset().mockResolvedValue(true);
  env.share.mockReset().mockResolvedValue(undefined);
  env.files.clear();
  env.ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
});

function addFile(uri: string, bytes = new Uint8Array([1, 2, 3]), name = "field plan.pdf", type = "application/pdf") {
  env.files.set(uri, { bytes, name, type, deleted: false });
}

describe("native meeting files", () => {
  it("persists a private copy for restart-safe offline upload", () => {
    const file = { id: "11111111-1111-4111-8111-111111111111", name: "field.jpg", type: "image/jpeg", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    const uri = persistMeetingFileForOffline(file);
    expect(uri).toContain("work-hub-queue");
    expect(env.files.get(uri)?.bytes).toEqual(file.bytes);
  });
  it("offers camera, photo library, and file seams and treats cancel as a no-op", async () => {
    env.camera.mockResolvedValue({ canceled: true });
    env.library.mockResolvedValue({ canceled: true });
    env.pick.mockRejectedValue(Object.assign(new Error("cancelled"), { code: "ERR_CANCELED" }));
    await expect(pickMeetingFile("camera")).resolves.toBeNull();
    await expect(pickMeetingFile("photos")).resolves.toBeNull();
    await expect(pickMeetingFile("files")).resolves.toBeNull();
    expect(env.camera).toHaveBeenCalledOnce();
    expect(env.library).toHaveBeenCalledOnce();
    expect(env.pick).toHaveBeenCalledOnce();
  });

  it("reports camera and photo permission denial before opening a picker", async () => {
    env.cameraPermission = "denied";
    await expect(pickMeetingFile("camera")).rejects.toMatchObject({ code: "permission.camera" });
    expect(env.camera).not.toHaveBeenCalled();
    env.libraryPermission = "denied";
    await expect(pickMeetingFile("photos")).rejects.toMatchObject({ code: "permission.photos" });
    expect(env.library).not.toHaveBeenCalled();
  });

  it("accepts successful image-picker assets by MIME even when their picker type is image", async () => {
    addFile("file:/camera.jpg", new Uint8Array([1]), "camera.jpg", "image/jpeg");
    env.camera.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///camera.jpg", type: "image", mimeType: "image/jpeg", fileName: "camera.jpg" }] });
    env.library.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///camera.jpg", type: "image", mimeType: "image/jpeg", fileName: "library.jpg" }] });
    await expect(pickMeetingFile("camera")).resolves.toMatchObject({ type: "image/jpeg", name: "camera.jpg" });
    await expect(pickMeetingFile("photos")).resolves.toMatchObject({ type: "image/jpeg", name: "library.jpg" });
  });

  it("uses a native broad file-picker MIME then validates the selected file exactly", async () => {
    env.pick.mockResolvedValue({ uri: "file:///picked", name: "notes.txt", type: "text/plain", size: 2, bytes: async () => new Uint8Array([1, 2]) });
    await expect(pickMeetingFile("files")).resolves.toMatchObject({ name: "notes.txt", type: "text/plain", size: 2 });
    expect(env.pick).toHaveBeenCalledWith(undefined, "*/*");
  });

  it("rejects a trustworthy declared oversize file before reading bytes", async () => {
    const bytes = vi.fn();
    env.pick.mockResolvedValue({ uri: "file:///huge.pdf", name: "huge.pdf", type: "application/pdf", size: 25 * 1024 * 1024 + 1, bytes });
    await expect(pickMeetingFile("files")).rejects.toMatchObject({ code: "validation.size" });
    expect(bytes).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", new Uint8Array(), "application/pdf", "validation.empty"],
    ["unsupported", new Uint8Array([1]), "application/zip", "validation.type"],
    ["oversize", new Uint8Array(25 * 1024 * 1024 + 1), "application/pdf", "validation.size"],
  ])("rejects %s input without returning an upload operation", async (_name, bytes, type, code) => {
    addFile("file:///picked", bytes, "picked.bin", type);
    env.pick.mockResolvedValue({ uri: "file:///picked", name: "picked.bin", type, size: bytes.length, bytes: async () => bytes });
    await expect(pickMeetingFile("files")).rejects.toMatchObject({ code });
  });

  it("rejects unreadable input and preserves a stable native UUID with copied bytes", async () => {
    env.pick.mockResolvedValue({ uri: "file:///missing", name: "report.pdf", type: "application/pdf", size: 10, bytes: async () => { throw new Error("read denied"); } });
    await expect(pickMeetingFile("files")).rejects.toMatchObject({ code: "validation.unreadable" });
    addFile("file:///picked", new Uint8Array([9, 8]), "report.pdf", "application/pdf");
    env.pick.mockResolvedValue({ uri: "file:///picked", name: "report.pdf", type: "application/pdf", size: 2, bytes: async () => new Uint8Array([9, 8]) });
    await expect(pickMeetingFile("files")).resolves.toMatchObject({ id: "11111111-1111-4111-8111-111111111111", name: "report.pdf", size: 2 });
  });

  it("uploads exact shared and private raw requests with encoded names and immutable bytes", async () => {
    env.raw.mockResolvedValue({ json: async () => ({ attachment: { fileName: "field plan.pdf" }, replayed: false }) });
    const file = { id: "11111111-1111-4111-8111-111111111111", name: "field plan.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    await uploadMeetingFile("meeting/a", file, null, authScope);
    await uploadMeetingFile("meeting/a", file, 23, authScope);
    expect(env.raw.mock.calls[0][0]).toBe("/api/work-hub/meetings/meeting%2Fa/files/11111111-1111-4111-8111-111111111111");
    expect(env.raw.mock.calls[1][0]).toBe("/api/work-hub/meetings/meeting%2Fa/files/11111111-1111-4111-8111-111111111111?recipient=23");
    expect(env.raw.mock.calls[0][1].headers).toMatchObject({ "content-type": "application/pdf", "x-file-name": "field%20plan.pdf" });
    expect(env.raw.mock.calls[0][1].body).toBeInstanceOf(Blob);
    expect(env.raw.mock.calls[0][2]).toBe(authScope);
  });

  it("downloads the exact scoped GET, verifies bytes, shares, and deletes its randomized cache file", async () => {
    env.raw.mockResolvedValue({
      headers: new Headers({ "content-type": "application/pdf", "content-length": "3" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const current = vi.fn();
    await downloadAndShareMeetingFile({ occurrenceId: "meeting/a", fileId: "file/b", fileName: "field plan.pdf", contentType: "application/pdf", byteSize: 3, authScope, assertCurrent: current });
    expect(env.raw).toHaveBeenCalledWith("/api/work-hub/meetings/meeting%2Fa/files/file%2Fb", expect.objectContaining({ method: "GET" }), authScope);
    expect(env.share).toHaveBeenCalledWith(expect.stringMatching(/^file:\/?cache\/11111111-.*-field-plan\.pdf$/), expect.objectContaining({ mimeType: "application/pdf" }));
    const temporary = [...env.files.values()].at(-1)!;
    expect(temporary.deleted).toBe(true);
    expect(current.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("downloads a replay file only through its opaque protected path and version contract", async () => {
    env.raw.mockResolvedValue({
      headers: new Headers({ "content-type": "application/pdf", "content-length": "3" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    await downloadAndShareMeetingReplayFile({
      occurrenceId: "meeting/a",
      replayEventId: "event/b",
      fileName: "receipt.pdf",
      contentType: "application/pdf",
      byteSize: 3,
      authScope,
      assertCurrent: vi.fn(),
    });
    expect(env.raw).toHaveBeenCalledWith(
      "/api/work-hub/meetings/meeting%2Fa/replay/files/event%2Fb",
      expect.objectContaining({
        method: "GET",
        headers: { "x-replay-renderer-version": "1", "x-replay-schema-version": "2" },
      }),
      authScope,
    );
    expect(env.share).toHaveBeenCalledOnce();
  });

  it.each([
    ["empty", new Uint8Array(), "application/pdf", "0"],
    ["wrong length", new Uint8Array([1, 2]), "application/pdf", "2"],
    ["wrong type", new Uint8Array([1, 2, 3]), "text/plain", "3"],
    ["oversize", new Uint8Array(25 * 1024 * 1024 + 1), "application/pdf", String(25 * 1024 * 1024 + 1)],
  ])("never shares a %s download and cleans any temporary file", async (_name, bytes, type, length) => {
    env.raw.mockResolvedValue({ headers: new Headers({ "content-type": type, "content-length": length }), arrayBuffer: async () => bytes.buffer });
    await expect(downloadAndShareMeetingFile({ occurrenceId: "m", fileId: "f", fileName: "x.pdf", contentType: "application/pdf", byteSize: 3, authScope, assertCurrent: vi.fn() })).rejects.toBeInstanceOf(MeetingFileFailure);
    expect(env.share).not.toHaveBeenCalled();
    expect([...env.files.values()].every((value) => value.deleted)).toBe(true);
  });

  it("deletes bytes and does not share when sharing is unavailable, fails, or scope changes", async () => {
    env.raw.mockResolvedValue({ headers: new Headers({ "content-type": "application/pdf", "content-length": "3" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    env.shareAvailable.mockResolvedValue(false);
    await expect(downloadAndShareMeetingFile({ occurrenceId: "m", fileId: "f", fileName: "x.pdf", contentType: "application/pdf", byteSize: 3, authScope, assertCurrent: vi.fn() })).rejects.toMatchObject({ code: "share.unavailable" });
    env.shareAvailable.mockResolvedValue(true);
    env.share.mockRejectedValue(new Error("share failed"));
    await expect(downloadAndShareMeetingFile({ occurrenceId: "m", fileId: "f", fileName: "x.pdf", contentType: "application/pdf", byteSize: 3, authScope, assertCurrent: vi.fn() })).rejects.toMatchObject({ code: "share.failed" });
    const stale = vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw Object.assign(new Error("stale"), { name: "AbortError" }); });
    env.share.mockResolvedValue(undefined);
    await expect(downloadAndShareMeetingFile({ occurrenceId: "m", fileId: "f", fileName: "x.pdf", contentType: "application/pdf", byteSize: 3, authScope, assertCurrent: stale })).rejects.toMatchObject({ name: "AbortError" });
    expect([...env.files.values()].every((value) => value.deleted)).toBe(true);
  });

  it("registers immediate temporary cleanup while the native share sheet is still open", async () => {
    let finishShare!: () => void;
    env.share.mockReturnValue(new Promise<void>((resolve) => { finishShare = resolve; }));
    env.raw.mockResolvedValue({ headers: new Headers({ "content-type": "application/pdf", "content-length": "3" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    let cleanup: (() => void) | null = null;
    const opening = downloadAndShareMeetingFile({
      occurrenceId: "m", fileId: "f", fileName: "x.pdf", contentType: "application/pdf", byteSize: 3,
      authScope, assertCurrent: vi.fn(), registerTemporaryCleanup: (next) => { cleanup = next; },
    });
    await vi.waitFor(() => expect(cleanup).toBeTypeOf("function"));
    cleanup!();
    expect([...env.files.values()].every((value) => value.deleted)).toBe(true);
    finishShare();
    await opening;
    expect(cleanup).toBeNull();
  });
});
