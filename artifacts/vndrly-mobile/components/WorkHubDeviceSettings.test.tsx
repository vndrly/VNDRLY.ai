import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-work-hub-device-presence", () => ({ nativeWorkHubDeviceIdentity: async () => ({ deviceId: "10000000-0000-4000-8000-000000000001" }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", text: "black", mutedForeground: "gray", border: "gray", destructive: "red", card: "white" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => ({
  "workHubDevices.title": "Audio and Backup Devices",
  "workHubDevices.thisDevice": "This device",
  "workHubDevices.voiceActive": "Voice active",
  "workHubDevices.readyForHandoff": "Ready for automatic voice handoff",
  "workHubDevices.noActiveVoice": "No call or meeting is using voice right now",
  "workHubDevices.voiceActiveOn": "Voice active on John's iPhone",
}[key] ?? key) }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, ...props }: any) => <button onClick={onPress} {...props}>{children}</button> }));

import WorkHubDeviceSettings from "./WorkHubDeviceSettings";

describe("iPhone Work Hub device settings", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/work-hub/devices") return [
        { id: "10000000-0000-4000-8000-000000000001", friendlyName: "John's iPhone", deviceClass: "phone", capabilities: { microphone: true }, revokedAt: null, currentAudioOwner: true },
        { id: "10000000-0000-4000-8000-000000000002", friendlyName: "Mobile device", deviceClass: "phone", capabilities: { microphone: true }, revokedAt: null },
      ];
      if (path === "/api/work-hub/devices/preferences") return { rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} };
      return {};
    });
  });
  afterEach(cleanup);

  it("identifies the current audio owner and enables automatic failover", async () => {
    render(<WorkHubDeviceSettings />);
    expect(await screen.findByText("Audio and Backup Devices")).toBeTruthy();
    expect(await screen.findByText("John's iPhone · This device")).toBeTruthy();
    expect(screen.getByText("Voice active on John's iPhone")).toBeTruthy();
    expect(screen.getByText("Voice active")).toBeTruthy();
    expect(screen.getByText("Mobile device")).toBeTruthy();
    expect(screen.getByText("Ready for automatic voice handoff")).toBeTruthy();
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/work-hub/devices/preferences", expect.objectContaining({ method: "PUT" })));
  });
});
