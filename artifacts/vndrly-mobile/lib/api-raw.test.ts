import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getToken: vi.fn(), captureScope: vi.fn(), isCurrent: vi.fn(), clearIfCurrent: vi.fn(),
  setToken: vi.fn(), setUser: vi.fn(),
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

import { apiFetch, apiFetchRaw } from "./api";

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

describe("authenticated scoped raw response transport", () => {
  it("preserves caller upload headers, bytes, signal, bearer token, and iOS client header", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: "file" }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await apiFetchRaw("/meeting-file", {
      method: "PUT", body, signal: controller.signal,
      headers: { "content-type": "image/png", "x-file-name": "proof.png" },
    }, scope);

    await expect(response.json()).resolves.toEqual({ id: "file" });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/meeting-file");
    expect(init.body).toBe(body);
    expect(init.signal).toBe(controller.signal);
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-a");
    expect(headers.get("x-vndrly-client")).toBe("ios");
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("x-file-name")).toBe("proof.png");
  });

  it("returns binary download bytes without forcing a JSON accept header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "application/pdf" } }));
    const response = await apiFetchRaw("/meeting-file", {}, scope);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([4, 5, 6]);
    const headers = vi.mocked(fetch).mock.calls[0][1]!.headers as Headers;
    expect(headers.get("accept")).toBeNull();
  });

  it("cancels before dispatch after a late user or membership switch", async () => {
    const token = deferred<string | null>();
    auth.getToken.mockReturnValueOnce(token.promise);
    const pending = apiFetchRaw("/meeting-file", {}, scope);
    auth.isCurrent.mockReturnValue(false);
    token.resolve("token-a");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels after response when the auth scope changed", async () => {
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const pending = apiFetchRaw("/meeting-file", {}, scope);
    await Promise.resolve(); await Promise.resolve();
    auth.isCurrent.mockReturnValue(false);
    response.resolve(new Response(new Uint8Array([9]), { status: 200 }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never returns bytes consumed after the auth scope changed", async () => {
    const bytes = deferred<ArrayBuffer>();
    const response = { ok: true, status: 200, headers: new Headers(), arrayBuffer: () => bytes.promise } as Response;
    vi.mocked(fetch).mockResolvedValueOnce(response);
    const raw = await apiFetchRaw("/meeting-file", {}, scope);
    const pending = raw.arrayBuffer();
    auth.isCurrent.mockReturnValue(false);
    bytes.resolve(new Uint8Array([7]).buffer);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves AbortError for a cancelled raw request", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await expect(apiFetchRaw("/meeting-file", {}, scope)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clears only a current session for a session-dead raw 401", async () => {
    let currentGeneration = scope.generation;
    auth.isCurrent.mockImplementation((candidate) => candidate.generation === currentGeneration);
    auth.captureScope.mockReturnValueOnce(cleanupScope);
    auth.clearIfCurrent.mockImplementationOnce(async () => { currentGeneration = cleanupScope.generation; return true; });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "auth.session_expired", message: "Expired" }), { status: 401 }));
    await expect(apiFetchRaw("/meeting-file", {}, scope)).rejects.toMatchObject({ status: 401, code: "auth.session_expired" });
    expect(auth.clearIfCurrent).toHaveBeenCalledWith(scope);
  });

  it("does not let a stale session-dead raw 401 clear newer auth", async () => {
    const body = deferred<{ code: string; message: string }>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers(), json: () => body.promise } as Response);
    const pending = apiFetchRaw("/meeting-file", {}, scope);
    await Promise.resolve(); await Promise.resolve();
    auth.isCurrent.mockReturnValue(false);
    body.resolve({ code: "auth.session_expired", message: "Expired" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(auth.clearIfCurrent).not.toHaveBeenCalled();
  });

  it.each([
    ["17", 17_000],
    ["Thu, 10 Sep 2026 18:00:10 GMT", Date.parse("Thu, 10 Sep 2026 18:00:10 GMT") - Date.parse("Thu, 10 Sep 2026 18:00:00 GMT")],
  ])("parses Retry-After %s on typed API errors", async (value, expected) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10T18:00:00Z"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "work_hub.busy", message: "Busy" }), { status: 429, headers: { "retry-after": value } }));
    try {
      await expect(apiFetchRaw("/meeting-file", {}, scope)).rejects.toMatchObject({ status: 429, code: "work_hub.busy", retryAfterMs: expected });
    } finally { vi.useRealTimers(); }
  });

  it.each([
    "later",
    "1.5",
    "2026-09-10",
    "Sep 10 2026",
    " 17",
    "17 ",
    "+17",
    "-1",
    "9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
  ])("omits Retry-After metadata when %s is not an RFC-valid value", async (value) => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: (name: string) => name.toLowerCase() === "retry-after" ? value : null },
      json: async () => ({ code: "work_hub.busy", message: "Busy" }),
    } as Response);
    const error = await apiFetchRaw("/meeting-file", {}, scope).catch((caught) => caught);
    expect(error).toMatchObject({ status: 429, code: "work_hub.busy" });
    expect(error).not.toHaveProperty("retryAfterMs");
  });

  it("accepts a strict past IMF-fixdate and clamps its delay to zero", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10T18:00:00Z"));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "work_hub.busy", message: "Busy" }), { status: 429, headers: { "retry-after": "Thu, 10 Sep 2026 17:59:50 GMT" } }));
    try {
      await expect(apiFetchRaw("/meeting-file", {}, scope)).rejects.toMatchObject({ retryAfterMs: 0 });
    } finally { vi.useRealTimers(); }
  });

  it("keeps existing JSON behavior through the shared request primitive", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(apiFetch("/ordinary", { method: "POST", body: JSON.stringify({ a: 1 }) }, scope)).resolves.toEqual({ ok: true });
    const headers = vi.mocked(fetch).mock.calls[0][1]!.headers as Headers;
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
  });
});
