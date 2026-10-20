import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeWorkHubSurface, useWorkHubDevicePresence } from "./use-work-hub-device-presence";

const env = vi.hoisted(() => ({ apiFetch: vi.fn(async (..._args: any[]) => ({})), register: vi.fn(async () => "22222222-2222-4222-8222-222222222222"), current: true, generation: 1 }));
vi.mock("@/lib/api", () => ({ apiFetch: env.apiFetch }));
vi.mock("@/lib/deviceId", () => ({ getDeviceId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/account-device-registration", () => ({ registerAccountWorkDevice: env.register }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: env.generation }), isAuthScopeCurrent: (scope: any) => env.current && scope.generation === env.generation }));

describe("native Work Hub device presence", () => {
  beforeEach(() => { env.apiFetch.mockClear(); env.register.mockClear(); env.current = true; env.generation = 1; });
  afterEach(() => { vi.useRealTimers(); });

  it("reports the current independent screen without its content", async () => {
    const { unmount } = renderHook(() => useWorkHubDevicePresence("/tickets/42?tab=notes", true));
    await waitFor(() => expect(env.apiFetch).toHaveBeenCalledTimes(1));
    expect(env.apiFetch.mock.calls[0][0]).toContain("/devices/22222222-2222-4222-8222-222222222222/heartbeat");
    expect(JSON.parse(String(env.apiFetch.mock.calls[0][1]?.body))).toMatchObject({
      surface: { path: "/tickets/42?tab=notes", entityType: "ticket", entityId: "42" },
    });
    unmount();
  });

  it("does not heartbeat an old account after registration finishes late", async () => {
    let finish!: (id: string) => void;
    env.register.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useWorkHubDevicePresence("/work-hub", true));
    await waitFor(() => expect(env.register).toHaveBeenCalledOnce());
    env.generation++; finish("22222222-2222-4222-8222-222222222222");
    await Promise.resolve(); await Promise.resolve();
    expect(env.apiFetch).not.toHaveBeenCalled(); unmount();
  });

  it("does nothing before authentication", () => {
    renderHook(() => useWorkHubDevicePresence("/work-hub", false));
    expect(env.apiFetch).not.toHaveBeenCalled();
  });

  it("classifies active meetings and leaves unrelated screens unclassified", () => {
    expect(nativeWorkHubSurface("/work-hub/meeting/meeting-a", 7)).toEqual({ path: "/work-hub/meeting/meeting-a", entityType: "meeting", entityId: "meeting-a", updatedAt: 7 });
    expect(nativeWorkHubSurface("/(tabs)/dashboard", 8)).toEqual({ path: "/(tabs)/dashboard", entityType: null, entityId: null, updatedAt: 8 });
  });
});
