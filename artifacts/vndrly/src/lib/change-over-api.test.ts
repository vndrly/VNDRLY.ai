import { afterEach, describe, expect, it, vi } from "vitest";
import { changeOverRequest } from "./change-over-api";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Gate request deadline", () => {
  it("reports interrupted writes as unconfirmed and never retries automatically", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetch = vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetch);
    await expect(changeOverRequest("/station/recover", { reason: "synthetic" })).rejects.toThrow("result is unconfirmed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves a canonical permission denial instead of describing it as a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Gate access denied", code: "access_denied" }) }));
    await expect(changeOverRequest("/station/state")).rejects.toMatchObject({ message: "Gate access denied", status: 403 });
  });
});
