import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getToken: vi.fn(),
  captureScope: vi.fn(),
  isCurrent: vi.fn(),
  clearIfCurrent: vi.fn(),
  setToken: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("./auth", () => ({
  getToken: auth.getToken,
  captureAuthScope: auth.captureScope,
  getUser: vi.fn(),
  setToken: auth.setToken,
  setUser: auth.setUser,
  isAuthScopeCurrent: auth.isCurrent,
  clearAuthIfCurrent: auth.clearIfCurrent,
}));

import { apiFetch } from "./api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const scope = { generation: 7 };
const cleanupScope = { generation: 8 };

beforeEach(() => {
  auth.getToken.mockReset().mockResolvedValue("token-a");
  auth.captureScope.mockReset().mockReturnValue(scope);
  auth.isCurrent.mockReset().mockReturnValue(true);
  auth.clearIfCurrent.mockReset().mockResolvedValue(true);
  auth.setToken.mockReset().mockResolvedValue(undefined);
  auth.setUser.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});

describe("scoped native apiFetch", () => {
  it("binds scope before a deferred token read and cancels before dispatch when it changes", async () => {
    const token = deferred<string | null>();
    auth.getToken.mockReturnValueOnce(token.promise);
    const pending = apiFetch("/private", {}, scope);
    auth.isCurrent.mockReturnValue(false);
    token.resolve("token-a");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors cancellation while a deferred token read is pending", async () => {
    const token = deferred<string | null>();
    const controller = new AbortController();
    auth.getToken.mockReturnValueOnce(token.promise);
    const pending = apiFetch("/private", { signal: controller.signal }, scope);

    controller.abort();
    token.resolve("token-a");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.clearIfCurrent).not.toHaveBeenCalled();
  });

  it("preserves AbortError instead of translating cancellation into offline", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await expect(apiFetch("/private", {}, scope)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels after a deferred success body when the auth scope changes", async () => {
    const text = deferred<string>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, text: () => text.promise } as Response);
    const pending = apiFetch("/private", {}, scope);
    await Promise.resolve();
    await Promise.resolve();
    auth.isCurrent.mockReturnValue(false);
    text.resolve(JSON.stringify({ private: true }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not let a late session-dead response clear newer auth", async () => {
    const body = deferred<{ code: string; message: string }>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: () => body.promise } as Response);
    const pending = apiFetch("/private", {}, scope);
    await Promise.resolve();
    await Promise.resolve();
    auth.isCurrent.mockReturnValue(false);
    body.resolve({ code: "auth.session_expired", message: "Expired" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(auth.clearIfCurrent).not.toHaveBeenCalled();
  });

  it("honors cancellation while a deferred session-dead body is pending", async () => {
    const body = deferred<{ code: string; message: string }>();
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: () => body.promise } as Response);
    const pending = apiFetch("/private", { signal: controller.signal }, scope);
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    body.resolve({ code: "auth.session_expired", message: "Expired" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(auth.clearIfCurrent).not.toHaveBeenCalled();
  });

  it("suppresses a stale 401 completion when a newer login wins during deferred cleanup", async () => {
    const cleanup = deferred<boolean>();
    let currentGeneration = scope.generation;
    auth.isCurrent.mockImplementation((candidate) => candidate.generation === currentGeneration);
    auth.captureScope.mockReturnValueOnce(cleanupScope);
    auth.clearIfCurrent.mockImplementationOnce(() => {
      currentGeneration = cleanupScope.generation;
      return cleanup.promise;
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: "auth.session_expired", message: "Expired" }),
    } as Response);
    const pending = apiFetch("/private", {}, scope);
    await vi.waitFor(() => expect(auth.clearIfCurrent).toHaveBeenCalledWith(scope));

    currentGeneration = 9;
    cleanup.resolve(true);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("honors cancellation while current-session cleanup is pending", async () => {
    const cleanup = deferred<boolean>();
    const controller = new AbortController();
    auth.clearIfCurrent.mockReturnValueOnce(cleanup.promise);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: "auth.session_expired", message: "Expired" }),
    } as Response);
    const pending = apiFetch("/private", { signal: controller.signal }, scope);
    await vi.waitFor(() => expect(auth.clearIfCurrent).toHaveBeenCalledWith(scope));

    controller.abort();
    cleanup.resolve(true);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("performs atomic auth cleanup for a current session-dead response", async () => {
    let currentGeneration = scope.generation;
    auth.isCurrent.mockImplementation((candidate) => candidate.generation === currentGeneration);
    auth.captureScope.mockReturnValueOnce(cleanupScope);
    auth.clearIfCurrent.mockImplementationOnce(async () => {
      currentGeneration = cleanupScope.generation;
      return true;
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: "auth.session_expired", message: "Expired" }),
    } as Response);

    await expect(apiFetch("/private", {}, scope)).rejects.toMatchObject({ status: 401 });
    expect(auth.clearIfCurrent).toHaveBeenCalledWith(scope);
  });
});

describe("ordinary unscoped native apiFetch", () => {
  it("preserves successful parsing and the native header contract", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as Response);
    await expect(apiFetch("/ordinary", { method: "POST", body: JSON.stringify({ a: 1 }) })).resolves.toEqual({ ok: true });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-a");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-vndrly-client")).toBe("ios");
  });

  it("does not clear auth for a wrong-role 401 without a session-dead code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 401, json: async () => ({ code: "auth.wrong_role", message: "Wrong role" }),
    } as Response);
    await expect(apiFetch("/ordinary")).rejects.toMatchObject({ status: 401, code: "auth.wrong_role" });
    expect(auth.setToken).not.toHaveBeenCalled();
    expect(auth.setUser).not.toHaveBeenCalled();
  });

  it("clears auth for a genuine current session-dead 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 401, json: async () => ({ code: "auth.session_expired", message: "Expired" }),
    } as Response);
    await expect(apiFetch("/ordinary")).rejects.toMatchObject({ status: 401, code: "auth.session_expired" });
    expect(auth.clearIfCurrent).toHaveBeenCalledWith(scope);
  });

  it("does not let an ordinary late old-session 401 clear a newer login", async () => {
    const body = deferred<{ code: string; message: string }>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: () => body.promise } as Response);
    const pending = apiFetch("/ordinary");
    await Promise.resolve();
    await Promise.resolve();
    auth.isCurrent.mockReturnValue(false);
    body.resolve({ code: "auth.session_expired", message: "Expired" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(auth.clearIfCurrent).not.toHaveBeenCalled();
  });
});
