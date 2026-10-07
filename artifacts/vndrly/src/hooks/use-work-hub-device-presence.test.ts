import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workHubDeviceIdentity, workHubSurfaceForPath, useWorkHubDevicePresence } from "./use-work-hub-device-presence";

const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/work-hub-client", async (load) => ({ ...(await load<object>()), workHubRequest: boundary.request }));

describe("shared terminal device identity", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it("keeps the same user's identity while separating another signed-in user", () => {
    const first = workHubDeviceIdentity(1);
    expect(workHubDeviceIdentity(1)).toEqual(first);
    const second = workHubDeviceIdentity(2);
    expect(second?.deviceId).not.toBe(first?.deviceId);
    expect(second?.connectionId).not.toBe(first?.connectionId);
    expect(workHubDeviceIdentity(1)).toEqual(first);
  });
  it("does not adopt an old device with unproven ownership", () => {
    localStorage.setItem("vndrly.workHubDeviceId", "another-users-device");
    expect(workHubDeviceIdentity(1)?.deviceId).not.toBe("another-users-device");
  });
  it("does not create device identities for unsigned-in users", () => {
    for (const id of [undefined, null, 0, -1, 1.5]) expect(workHubDeviceIdentity(id)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("device presence account transitions", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); boundary.request.mockReset().mockResolvedValue({}); });
  it("does not heartbeat an old user's device after delayed registration finishes", async () => {
    let finishFirst!: () => void;
    const pending = new Promise<void>(resolve => { finishFirst = resolve; });
    boundary.request.mockImplementationOnce(() => pending);
    const { rerender, unmount } = renderHook(({ userId }) => useWorkHubDevicePresence("/work-hub", true, userId, "vendor:1"), { initialProps: { userId: 1 } });
    const oldId = workHubDeviceIdentity(1)!.deviceId;
    rerender({ userId: 2 });
    await act(async () => { finishFirst(); await pending; });
    expect(boundary.request.mock.calls.some(([path]) => path === `/devices/${oldId}/heartbeat`)).toBe(false);
    expect(boundary.request.mock.calls.some(([path]) => path === `/devices/${workHubDeviceIdentity(2)!.deviceId}/heartbeat`)).toBe(true);
    unmount();
  });
  it("registers again when the same user switches organizations", async () => {
    const { rerender, unmount } = renderHook(({ org }) => useWorkHubDevicePresence("/work-hub", true, 1, org), { initialProps: { org: "vendor:1" } });
    await act(async () => {});
    rerender({ org: "partner:2" });
    await act(async () => {});
    expect(boundary.request.mock.calls.filter(([path]) => path === "/devices/register")).toHaveLength(2);
    unmount();
  });
});

describe("cross-device active surface projection", () => {
  it.each([
    ["/tickets/42", "ticket", "42"],
    ["/site-locations/7", "site", "7"],
    ["/invoices/19?tab=lines", "invoice", "19"],
    ["/work-hub/meetings/occurrence-one", "meeting", "occurrence-one"],
    ["/work-hub/chat", null, null],
  ])("projects %s without exposing page contents", (path, entityType, entityId) => {
    expect(workHubSurfaceForPath(path, 100)).toEqual({ path, entityType, entityId, updatedAt: 100 });
  });
});
