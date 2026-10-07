import { beforeEach, afterEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn(), pick: vi.fn(), current: true }));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => ({ status: "granted" }),
  launchCameraAsync: env.pick,
}));
vi.mock("./api", () => ({
  apiFetch: env.api,
  getApiBase: () => "https://vndrly.ai",
}));
vi.mock("./auth", () => ({ isAuthScopeCurrent: () => env.current }));
import { captureAndUploadImage } from "./photos";
const id = "10000000-0000-4000-8000-000000000001",
  objectPath = `/objects/uploads/${id}`;
beforeEach(() => {
  env.current = true;
  env.pick
    .mockReset()
    .mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///actual-photo", mimeType: "image/jpeg" }],
    });
  env.api
    .mockReset()
    .mockImplementation(async (path) =>
      path.endsWith("request-url")
        ? {
            uploadURL: `https://vndrly.ai/api/storage/upload/${id}`,
            objectPath,
          }
        : { objectPath },
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) =>
      options?.method === "PUT"
        ? { ok: true }
        : {
            blob: async () =>
              new Blob(["actual-bytes"], { type: "image/jpeg" }),
          },
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("finalizes actual bytes privately with the original authorization scope", async () => {
  const scope = { generation: 1 };
  expect(await captureAndUploadImage({ authScope: scope })).toMatchObject({
    objectPath,
    contentType: "image/jpeg",
  });
  expect(env.api.mock.calls[1][2]).toBe(scope);
  expect(JSON.parse(env.api.mock.calls[1][1].body)).toMatchObject({
    visibility: "private",
  });
});
it("refuses account switch during camera before any upload request", async () => {
  env.pick.mockImplementationOnce(async () => {
    env.current = false;
    return { canceled: false, assets: [{ uri: "file:///actual-photo" }] };
  });
  await expect(
    captureAndUploadImage({ authScope: { generation: 1 } }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(env.api).not.toHaveBeenCalled();
});
it("refuses account switch during upload before private finalization", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      if (options?.method === "PUT") {
        env.current = false;
        return { ok: true };
      }
      return { blob: async () => new Blob(["actual-bytes"]) };
    }),
  );
  await expect(
    captureAndUploadImage({ authScope: { generation: 1 } }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(env.api).toHaveBeenCalledTimes(1);
});
it("refuses external upload destinations and mismatched finalized paths", async () => {
  env.api.mockResolvedValueOnce({
    uploadURL: `https://foreign.invalid/api/storage/upload/${id}`,
    objectPath,
  });
  await expect(
    captureAndUploadImage({ authScope: { generation: 1 } }),
  ).rejects.toThrow("Unexpected");
  env.api
    .mockResolvedValueOnce({
      uploadURL: `https://vndrly.ai/api/storage/upload/${id}`,
      objectPath,
    })
    .mockResolvedValueOnce({ objectPath: "/objects/uploads/other" });
  await expect(
    captureAndUploadImage({ authScope: { generation: 1 } }),
  ).rejects.toThrow("not verified");
});
