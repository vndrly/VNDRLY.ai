import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setToken } from "./auth";
import { syncAppIconBadge, useUnreadNotificationCount } from "./notificationBadge";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch: api }));
vi.mock("expo-notifications", () => ({ setBadgeCountAsync: vi.fn().mockResolvedValue(undefined) }));
beforeEach(async () => { vi.useFakeTimers(); api.mockReset(); await setToken("first-account"); });
afterEach(async () => { cleanup(); await setToken(null); vi.useRealTimers(); });

describe("shared notification count", () => {
  it("uses the server's visible-category total and one poll for all header consumers", async () => {
    api.mockResolvedValue({ count: 28 }); // Seven authorized category totals: 1+2+3+4+5+6+7.
    const owner = renderHook(() => useUnreadNotificationCount(true));
    const header = renderHook(() => useUnreadNotificationCount());
    const detailHeader = renderHook(() => useUnreadNotificationCount(true));
    await act(async () => {});
    expect(owner.result.current).toBe(28);
    expect(header.result.current).toBe(28);
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/notifications/unread-count");
    api.mockResolvedValue({ count: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(header.result.current).toBe(0);
    expect(api).toHaveBeenCalledTimes(2);
    owner.unmount();
    api.mockResolvedValue({ count: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(detailHeader.result.current).toBe(3);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("coalesces read/push refreshes and discards late counts across account changes", async () => {
    let finish!: (data: { count: number }) => void;
    api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const owner = renderHook(() => useUnreadNotificationCount(true));
    let old!: Promise<void>;
    act(() => { old = syncAppIconBadge(); });
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValue({ count: 2 });
    await act(async () => { await setToken("other-account"); });
    expect(owner.result.current).toBe(2);
    await act(async () => { finish({ count: 99 }); await old; });
    expect(owner.result.current).toBe(2);
    await act(async () => { await setToken(null); });
    expect(owner.result.current).toBe(0);
  });
});
