import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setToken } from "./auth";
import { applyPushBadgeFromPayload, syncAppIconBadge, useUnreadNotificationCount } from "./notificationBadge";

const api = vi.hoisted(() => vi.fn());
const lifecycle = vi.hoisted(() => ({ state: "active", platform: "web", listener: null as null | ((state: string) => void), removes: vi.fn() }));
vi.mock("react-native", async original => ({ ...await original<typeof import("react-native")>(), Platform: { get OS() { return lifecycle.platform; } }, AppState: {
  get currentState() { return lifecycle.state; },
  addEventListener: (_event: string, listener: (state: string) => void) => {
    lifecycle.listener = listener;
    return { remove: () => { lifecycle.listener = null; lifecycle.removes(); } };
  },
} }));
vi.mock("@/lib/api", () => ({ apiFetch: api }));
vi.mock("expo-notifications", () => ({ setBadgeCountAsync: vi.fn().mockResolvedValue(undefined) }));
beforeEach(async () => { vi.useFakeTimers(); api.mockReset(); lifecycle.state = "active"; lifecycle.platform = "web"; lifecycle.removes.mockClear(); await setToken("first-account"); });
afterEach(async () => { cleanup(); await setToken(null); vi.useRealTimers(); });

describe("shared notification count", () => {
  it("refreshes the shared foreground count from the central push handler even when payload has a badge", async () => {
    lifecycle.platform = "ios";
    api.mockResolvedValue({ count: 0 });
    const owner = renderHook(() => useUnreadNotificationCount(true));
    await act(async () => {});
    api.mockResolvedValue({ count: 7 });
    await act(async () => { await applyPushBadgeFromPayload({ badge: 7 }); });
    expect(owner.result.current).toBe(7);
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("queues one trailing authoritative refresh when reads invalidate an older poll", async () => {
    let finish!: (data: { count: number }) => void;
    api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ count: 0 });
    const owner = renderHook(() => useUnreadNotificationCount(true));
    let read!: Promise<void>, readAll!: Promise<void>;
    act(() => { read = syncAppIconBadge(); readAll = syncAppIconBadge(); });
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ count: 6 }); await Promise.all([read, readAll]); });
    expect(api).toHaveBeenCalledTimes(2);
    expect(owner.result.current).toBe(0);
  });

  it("parks background polling, ignores late responses, and resumes once without leaking timers", async () => {
    let finish!: (data: { count: number }) => void;
    api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ count: 2 });
    const owner = renderHook(() => useUnreadNotificationCount(true));
    const other = renderHook(() => useUnreadNotificationCount(true));
    await act(async () => { lifecycle.state = "inactive"; lifecycle.listener?.("inactive"); finish({ count: 9 }); });
    expect(owner.result.current).toBe(0);
    await act(async () => { lifecycle.state = "background"; lifecycle.listener?.("background"); await vi.advanceTimersByTimeAsync(90_000); await syncAppIconBadge(); });
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => { lifecycle.state = "active"; lifecycle.listener?.("active"); });
    expect(owner.result.current).toBe(2);
    expect(api).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api).toHaveBeenCalledTimes(3);
    owner.unmount(); other.unmount();
    expect(lifecycle.removes).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a poll while mounted in the background", async () => {
    lifecycle.state = "background";
    api.mockResolvedValue({ count: 4 });
    const owner = renderHook(() => useUnreadNotificationCount(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api).not.toHaveBeenCalled();
    await act(async () => { lifecycle.state = "active"; lifecycle.listener?.("active"); });
    expect(owner.result.current).toBe(4);
    expect(api).toHaveBeenCalledTimes(1);
  });
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
