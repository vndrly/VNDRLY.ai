import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeWorkHubSurface, useWorkHubDevicePresence } from "./use-work-hub-device-presence";

const env = vi.hoisted(() => ({ apiFetch: vi.fn(async (..._args: any[]) => ({})) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.apiFetch }));
vi.mock("@/lib/deviceId", () => ({ getDeviceId: async () => "11111111-1111-4111-8111-111111111111" }));

describe("native Work Hub device presence", () => {
  beforeEach(() => { env.apiFetch.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("reports the current independent screen without its content", async () => {
    const { unmount } = renderHook(() => useWorkHubDevicePresence("/tickets/42?tab=notes", true));
    await waitFor(() => expect(env.apiFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(env.apiFetch.mock.calls[1][1]?.body))).toMatchObject({
      surface: { path: "/tickets/42?tab=notes", entityType: "ticket", entityId: "42" },
    });
    unmount();
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
