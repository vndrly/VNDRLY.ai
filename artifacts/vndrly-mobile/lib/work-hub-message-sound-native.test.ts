import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ generation: 1, granted: true, user: { id: 7 } as { id: number } | null, token: "test", active: "active", api: vi.fn(), play: vi.fn() }));
vi.mock("react-native", () => ({ AppState: { get currentState() { return env.active; } } }));
vi.mock("expo-notifications", () => ({ getPermissionsAsync: async () => ({ granted: env.granted }) }));
vi.mock("./api", () => ({ apiFetch: env.api }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({ generation: env.generation }), isAuthScopeCurrent: (s: { generation: number }) => s.generation === env.generation, getUser: async () => env.user, getToken: async () => env.token }));
vi.mock("./notificationSounds", () => ({ handleForegroundNotificationSound: env.play }));
beforeEach(() => { env.generation = 1; env.granted = true; env.user = { id: 7 }; env.token = "test"; env.active = "active"; env.api.mockReset(); env.play.mockReset(); vi.resetModules(); });
it("reads only current authenticated visible notifications/preferences before one sound attempt", async () => {
  env.api.mockImplementation(async (path: string) => path.includes("preferences") ? { pushEnabled: true, workHubMessagesEnabled: true, dndStartHour: null, dndEndHour: null } : [{ id: 12, type: "work_hub_message", createdAt: new Date().toISOString(), isRead: false }]);
  const { handleWorkHubMessageSound } = await import("./work-hub-message-sound-native");
  expect(await handleWorkHubMessageSound({ type: "work_hub_message", notificationId: 12 })).toBe(true);
  expect(env.api.mock.calls.every(call => call[2].generation === 1)).toBe(true);
  expect(env.play).toHaveBeenCalledOnce();
});
it("does not fetch or sound without account/OS permission or in background", async () => {
  const { handleWorkHubMessageSound } = await import("./work-hub-message-sound-native");
  env.granted = false; expect(await handleWorkHubMessageSound({ type: "work_hub_message", notificationId: 12 })).toBe(false);
  env.granted = true; env.user = null; expect(await handleWorkHubMessageSound({ type: "work_hub_message", notificationId: 12 })).toBe(false);
  env.user = { id: 7 }; env.active = "background"; expect(await handleWorkHubMessageSound({ type: "work_hub_message", notificationId: 12 })).toBe(false);
  expect(env.api).not.toHaveBeenCalled(); expect(env.play).not.toHaveBeenCalled();
});
