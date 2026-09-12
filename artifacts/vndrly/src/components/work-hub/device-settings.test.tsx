import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));

import WorkHubDeviceSettings from "./device-settings";

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WorkHubDeviceSettings /></QueryClientProvider>);
}

describe("Work Hub device settings", () => {
  beforeEach(() => {
    mocks.admin = false;
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/devices/preferences") return { rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} };
      if (path === "/devices") return [{ id: "10000000-0000-4000-8000-000000000001", userId: 7, friendlyName: "Desktop", deviceClass: "desktop", capabilities: { microphone: true }, revokedAt: null, updatedAt: new Date().toISOString(), currentAudioOwner: true }];
      if (path === "/devices?scope=organization") return [{ id: "20000000-0000-4000-8000-000000000002", userId: 8, friendlyName: "Crew phone", deviceClass: "phone", capabilities: { microphone: true }, revokedAt: null, updatedAt: new Date().toISOString() }];
      return {};
    });
  });
  afterEach(cleanup);

  it("shows the current audio device and saves automatic backup preference", async () => {
    mount();
    expect(await screen.findByText("Desktop")).toBeTruthy();
    expect(screen.getByText("workHubDevices.audioOwner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "workHubDevices.allowBackup" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/devices/preferences", expect.objectContaining({ method: "PUT" })));
    expect(mocks.request).not.toHaveBeenCalledWith("/devices?scope=organization", expect.anything());
  });

  it("lets a company administrator revoke a colleague device through the company scope", async () => {
    mocks.admin = true;
    mount();
    expect(await screen.findByText("Crew phone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "workHubDevices.revoke" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/devices/20000000-0000-4000-8000-000000000002?scope=organization", expect.objectContaining({ method: "DELETE" })));
  });
});
