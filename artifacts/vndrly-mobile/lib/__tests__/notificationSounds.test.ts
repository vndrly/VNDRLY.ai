import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

describe("notificationSounds", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exports the push sound filename bundled via expo-notifications", async () => {
    const mod = await import("@/lib/notificationSounds");
    expect(mod.PUSH_NOTIFICATION_SOUND).toBe("vndrly_bell_ring.wav");
  });

  it("no-ops foreground tolling on web", async () => {
    const mod = await import("@/lib/notificationSounds");
    expect(() => mod.handleForegroundNotificationSound()).not.toThrow();
    expect(() => mod.stopBellTolling()).not.toThrow();
  });
});
