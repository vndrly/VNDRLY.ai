import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), admin: false }));
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: mocks.request,
  isWorkHubAdmin: () => mocks.admin,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 12 } }) }));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({ workHubDeviceIdentity: () => ({ deviceId: "10000000-0000-4000-8000-000000000001" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import WorkHubDeviceSettings from "./device-settings";

const desktop = { id: "10000000-0000-4000-8000-000000000001", userId: 7, friendlyName: "Desktop", deviceClass: "desktop", capabilities: { microphone: true }, revokedAt: null, connected: true, currentAudioOwner: true };
const crewPhone = { id: "20000000-0000-4000-8000-000000000002", userId: 8, friendlyName: "Crew phone", deviceClass: "phone", capabilities: { microphone: true }, revokedAt: null, connected: true };

function mount(props: React.ComponentProps<typeof WorkHubDeviceSettings> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WorkHubDeviceSettings {...props} /></QueryClientProvider>);
}

describe("Work Hub device settings", () => {
  beforeEach(() => {
    mocks.admin = false;
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/devices/preferences") return { rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} };
      if (path === "/devices") return [desktop, { ...desktop, id: "old-desktop", friendlyName: "Old desktop", connected: false }];
      if (path === "/devices?scope=organization") return [
        crewPhone,
        { ...crewPhone, id: "old-phone", friendlyName: "Old phone", connected: false },
        { ...crewPhone, id: "revoked-phone", friendlyName: "Revoked phone", revokedAt: "2026-11-20T00:00:00.000Z" },
      ];
      return {};
    });
  });
  afterEach(cleanup);

  it("shows Disconnect on the current audio device beside Forget device", async () => {
    const onDisconnect = vi.fn();
    mount({ onDisconnect });
    expect(await screen.findByText("Desktop")).toBeTruthy();
    expect(screen.queryByText("Old desktop")).toBeNull();
    expect(screen.getByText("workHubDevices.audioOwner")).toBeTruthy();
    const disconnect = screen.getByRole("button", { name: "workHubDevices.disconnect" });
    const forget = screen.getByRole("button", { name: "workHubDevices.forget" });
    expect(disconnect.parentElement).toBe(forget.parentElement);
    expect(disconnect.classList.contains("vendor-mini-card-button")).toBe(true);
    expect(screen.queryByRole("button", { name: /allowBackup|backupEnabled/ })).toBeNull();
    expect(within(screen.getByRole("button", { name: "workHubDevices.moveUp" })).getByTestId("sphere-back-circle")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "workHubDevices.moveDown" })).getByTestId("sphere-back-circle")).toBeTruthy();
    fireEvent.click(disconnect);
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalledWith("/devices?scope=organization", expect.anything());
  });

  it("pins the live device and takes over on this device while the arrows reorder backups", async () => {
    const phone = { ...crewPhone, userId: desktop.userId };
    const tablet = { ...phone, id: "tablet", friendlyName: "Tablet" };
    const activeAudio = { deviceId: phone.id, occurrenceId: "room-a", callId: null, title: "Morning meeting" };
    const onTakeOver = vi.fn();
    let preferences = { rankedDeviceIds: [desktop.id, tablet.id], automaticBackupDeviceIds: [], learning: {} };
    mocks.request.mockImplementation(async (path, options?: RequestInit) => {
      if (path === "/devices") return [desktop, tablet, phone];
      if (path === "/devices/preferences") {
        if (options?.method === "PUT") preferences = JSON.parse(String(options.body));
        return preferences;
      }
      return {};
    });
    mount({ activeAudio, onTakeOver, onDisconnect: vi.fn() });
    const sections = () => screen.getAllByRole("region").map(item => item.getAttribute("aria-label"));
    const current = await screen.findByRole("region", { name: "Desktop" });
    expect(sections()).toEqual(["Crew phone", "Desktop", "Tablet"]);
    expect(screen.getAllByRole("button", { name: "workHubDevices.takeOver" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "workHubDevices.disconnect" })).toBeNull();
    fireEvent.click(within(current).getByRole("button", { name: "workHubDevices.takeOver" }));
    expect(onTakeOver).toHaveBeenCalledWith(activeAudio);
    const lower = within(current).getByRole<HTMLButtonElement>("button", { name: "workHubDevices.moveDown" });
    await waitFor(() => expect(lower.disabled).toBe(false));
    fireEvent.click(lower);
    await waitFor(() => expect(sections()).toEqual(["Crew phone", "Tablet", "Desktop"]));
  });

  it("shows only the signed-in account's connected devices even for a company administrator", async () => {
    mocks.admin = true;
    mount();
    expect(await screen.findByText("Desktop")).toBeTruthy();
    expect(screen.queryByText("Crew phone")).toBeNull();
    expect(screen.queryByText("Old desktop")).toBeNull();
    expect(screen.queryByText("Old phone")).toBeNull();
    expect(screen.queryByText("Revoked phone")).toBeNull();
    expect(mocks.request.mock.calls.some(([path]) => path.includes("scope=organization"))).toBe(false);
  });
});
