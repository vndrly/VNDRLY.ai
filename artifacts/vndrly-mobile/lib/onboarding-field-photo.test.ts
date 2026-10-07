import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pickOnboardingFieldPhoto } from "./onboarding-field-photo";
const env = vi.hoisted(() => ({ api: vi.fn(), pick: vi.fn(), current: true }));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ status: "granted" }),
  launchImageLibraryAsync: env.pick,
  MediaTypeOptions: { Images: "images" },
}));
vi.mock("./api", () => ({
  apiFetch: env.api,
  getApiBase: () => "https://vndrly.ai",
}));
vi.mock("./auth", () => ({ isAuthScopeCurrent: () => env.current }));
const id = "11111111-1111-4111-8111-111111111111",
  path = `/objects/uploads/${id}`;
beforeEach(() => {
  env.current = true;
  env.api.mockReset().mockImplementation(async (endpoint) =>
    endpoint.endsWith("/upload-url")
      ? {
          uploadURL: `https://vndrly.ai/api/storage/upload/${id}`,
          objectPath: path,
        }
      : { objectPath: path },
  );
  env.pick.mockReset().mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///actual-device-image", mimeType: "image/jpeg" }],
  });
});
afterEach(() => vi.unstubAllGlobals());
it("uploads chosen actual bytes and returns only the exact canonical finalized path", async () => {
  const fetch = vi.fn(async (_url: any, options?: any) =>
    options?.method === "PUT"
      ? { ok: true }
      : {
          blob: async () =>
            new Blob(["actual synthetic image bytes"], { type: "image/jpeg" }),
        },
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await pickOnboardingFieldPhoto(
      "synthetic-invite",
      { generation: 1 },
      new AbortController().signal,
    ),
  ).toBe(`/api/storage${path}`);
  expect(fetch.mock.calls[1][1]).toMatchObject({
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
  });
  expect(env.api.mock.calls[1][0]).toBe(
    "/api/onboarding/field/by-token/synthetic-invite/upload-finalize",
  );
});
it("refuses an unexpected upload origin before transmitting image bytes", async () => {
  env.api.mockResolvedValue({
    uploadURL: `https://foreign.invalid/api/storage/upload/${id}`,
    objectPath: path,
  });
  const fetch = vi.fn(async () => ({
    blob: async () => new Blob(["actual bytes"], { type: "image/jpeg" }),
  }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    pickOnboardingFieldPhoto(
      "synthetic-invite",
      { generation: 1 },
      new AbortController().signal,
    ),
  ).rejects.toThrow("Unexpected upload destination");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not request a picker or upload after account scope is stale", async () => {
  env.current = false;
  await expect(
    pickOnboardingFieldPhoto(
      "synthetic-invite",
      { generation: 1 },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(env.pick).not.toHaveBeenCalled();
  expect(env.api).not.toHaveBeenCalled();
});
it("refuses finalization after the account changes during the binary upload", async () => {
  const fetch = vi.fn(async (_url: any, options?: any) => {
    if (options?.method === "PUT") {
      env.current = false;
      return { ok: true };
    }
    return {
      blob: async () => new Blob(["actual bytes"], { type: "image/jpeg" }),
    };
  });
  vi.stubGlobal("fetch", fetch);
  await expect(
    pickOnboardingFieldPhoto(
      "synthetic-invite",
      { generation: 1 },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(
    env.api.mock.calls.some(([path]) => path.endsWith("/upload-finalize")),
  ).toBe(false);
});
