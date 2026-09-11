import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: secure.get,
  setItemAsync: secure.set,
  deleteItemAsync: secure.remove,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  secure.get.mockReset().mockResolvedValue(null);
  secure.set.mockReset().mockResolvedValue(undefined);
  secure.remove.mockReset().mockResolvedValue(undefined);
});

describe("native auth scopes", () => {
  it("invalidates a captured scope synchronously before secure storage finishes", async () => {
    const write = deferred<void>();
    secure.set.mockReturnValueOnce(write.promise);
    const auth = await import("./auth");
    const listener = vi.fn();
    auth.subscribeToken(listener);
    const scope = auth.captureAuthScope();

    const pending = auth.setToken("new-token");

    expect(auth.isAuthScopeCurrent(scope)).toBe(false);
    expect(auth.getCachedToken()).toBe("new-token");
    expect(listener).toHaveBeenCalledWith("new-token");
    write.resolve();
    await pending;
  });

  it("does not let a stale deferred token read overwrite a newer token", async () => {
    const read = deferred<string | null>();
    secure.get.mockReturnValueOnce(read.promise);
    const auth = await import("./auth");

    const pendingRead = auth.getToken();
    await auth.setToken("fresh-token");
    read.resolve("stale-token");

    await expect(pendingRead).resolves.toBe("fresh-token");
    expect(auth.getCachedToken()).toBe("fresh-token");
  });

  it("orders secure token writes so an older removal cannot finish after a newer login", async () => {
    const removal = deferred<void>();
    secure.remove.mockReturnValueOnce(removal.promise);
    const auth = await import("./auth");

    const clearing = auth.setToken(null);
    const setting = auth.setToken("replacement-token");

    expect(auth.getCachedToken()).toBe("replacement-token");
    expect(secure.set).not.toHaveBeenCalled();
    removal.resolve();
    await Promise.all([clearing, setting]);
    expect(secure.set).toHaveBeenCalledWith("vndrly.token", "replacement-token");
  });

  it("never restores an old stored user while a newer user write is queued", async () => {
    const write = deferred<void>();
    secure.set.mockReturnValueOnce(write.promise);
    secure.get.mockResolvedValueOnce(JSON.stringify({ id: 1, username: "old", displayName: "Old User", role: "vendor" }));
    const auth = await import("./auth");
    const freshUser = { id: 2, username: "fresh", displayName: "Fresh User", role: "partner" };

    const pendingWrite = auth.setUser(freshUser);

    await expect(auth.getUser()).resolves.toEqual(freshUser);
    expect(auth.getCachedRole()).toBe("partner");
    write.resolve();
    await pendingWrite;
  });

  it("keeps a cleared user authoritative while its storage removal is queued", async () => {
    const removal = deferred<void>();
    secure.remove.mockReturnValueOnce(removal.promise);
    secure.get.mockResolvedValueOnce(JSON.stringify({ id: 1, username: "old", displayName: "Old User", role: "vendor" }));
    const auth = await import("./auth");

    const pendingRemoval = auth.setUser(null);

    await expect(auth.getUser()).resolves.toBeNull();
    expect(auth.getCachedRole()).toBeNull();
    removal.resolve();
    await pendingRemoval;
  });
});
