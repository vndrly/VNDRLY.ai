import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ api: vi.fn(), adopt: vi.fn(), current: true, user: { id: 7, activeMembershipId: 4, vendorId: 12 } }));
vi.mock("./api", () => ({ apiFetch: m.api }));
vi.mock("./auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => m.current, getUser: async () => m.user }));
vi.mock("./deviceId", () => ({ getDeviceId: async () => "old", adoptAccountDeviceId: m.adopt }));
vi.mock("./work-hub-device-label", () => ({ workHubDeviceClass: () => "phone", workHubDeviceLabel: () => "iPhone" }));
vi.mock("./push", () => ({ rebindRegisteredPushToken: vi.fn() }));
import { registerAccountWorkDevice } from "./account-device-registration";
beforeEach(() => {
  vi.clearAllMocks(); m.current = true;
  m.api.mockImplementation(async (url: string) => {
    if (url.endsWith("/register")) return { id: "new", userId: 7, owner: { type: "vendor", id: 12 } };
    if (url.endsWith("/inherit-consent")) return { inherited: true };
    if (url.endsWith("/status")) return { designatedDeviceId: "old" };
    return {};
  });
});
it("inherits only this account's consent and repairs the same installation's phone binding before adopting its ID", async () => {
  expect(await registerAccountWorkDevice()).toBe("new");
  expect(JSON.parse(m.api.mock.calls[0][1].body)).toMatchObject({ deviceId: "old", separateAccount: true, deviceClass: "phone" });
  expect(m.api.mock.calls.map(([url]) => url)).toEqual(["/api/work-hub/devices/register", "/api/work-hub/devices/new/inherit-consent", "/api/native-operations/status", "/api/native-operations/device"]);
  expect(m.adopt).toHaveBeenCalledWith("new", 7, 4);
});
it("does not transfer another designated phone or manufacture missing consent", async () => {
  m.api.mockImplementation(async (url: string) => url.endsWith("/register") ? { id: "new", userId: 7, owner: { type: "vendor", id: 12 } } : url.endsWith("/inherit-consent") ? { inherited: false } : { designatedDeviceId: "different" });
  await registerAccountWorkDevice();
  expect(m.api.mock.calls.some(([url]) => url === "/api/native-operations/device")).toBe(false);
  expect(m.api.mock.calls.some(([url]) => url === "/api/location-consents")).toBe(false);
});
it("does not adopt a registration or send a repair after the account changes", async () => {
  m.api.mockImplementation(async () => { m.current = false; return { id: "new", userId: 7, owner: { type: "vendor", id: 12 } }; });
  await expect(registerAccountWorkDevice()).rejects.toThrow();
  expect(m.adopt).not.toHaveBeenCalled(); expect(m.api).toHaveBeenCalledTimes(1);
});
it("rejects an enrollment returned for a different user", async () => {
  m.api.mockResolvedValue({ id: "new", userId: 8, owner: { type: "vendor", id: 12 } });
  await expect(registerAccountWorkDevice()).rejects.toThrow(); expect(m.adopt).not.toHaveBeenCalled();
});
