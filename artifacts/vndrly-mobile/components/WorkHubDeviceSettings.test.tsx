import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({ nativeWorkHubDeviceIdentity: async () => ({ deviceId: "10000000-0000-4000-8000-000000000001" }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", text: "black", mutedForeground: "gray", border: "gray", destructive: "red", card: "white" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, ...props }: any) => <button onClick={onPress} {...props}>{children}</button> }));

import WorkHubDeviceSettings from "./WorkHubDeviceSettings";

describe("iPhone Work Hub device settings", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/work-hub/devices") return [{ id: "10000000-0000-4000-8000-000000000001", friendlyName: "John's iPhone", deviceClass: "phone", capabilities: { microphone: true }, revokedAt: null, currentAudioOwner: true }];
      if (path === "/api/work-hub/devices/preferences") return { rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} };
      return {};
    });
  });
  afterEach(cleanup);

  it("identifies the current audio owner and enables automatic failover", async () => {
    render(<WorkHubDeviceSettings />);
    expect(await screen.findByText(/John's iPhone/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "workHubDevices.allowBackup" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/work-hub/devices/preferences", expect.objectContaining({ method: "PUT" })));
  });
});
