import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/gate",
  setMuted: vi.fn(),
  voice: {
    preferencesReady: true,
    state: "stopped",
    muted: false,
  },
}));

vi.mock("expo-router", () => ({
  router: { push: env.navigate },
  usePathname: () => env.pathname,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-askv-voice-session", () => ({
  useAskVVoiceSession: () => ({ ...env.voice, setMuted: env.setMuted }),
}));
vi.mock("@/components/LayeredPillButton", () => ({
  default: ({ children, color, inactive, onPress, source, testID }: { children: React.ReactNode; color?: string; inactive?: boolean; onPress: () => void; source?: unknown; testID?: string }) => (
    <div data-color={color ?? "brand"} data-inactive={inactive ? "true" : "false"} data-source={String(source ?? "")} data-testid={testID} onClick={onPress}>{children}</div>
  ),
}));

import AskVVoiceIndicator from "./AskVVoiceIndicator";

afterEach(() => {
  cleanup();
  env.pathname = "/gate";
  env.voice.state = "stopped";
  env.voice.muted = false;
  env.navigate.mockReset();
  env.setMuted.mockReset();
});

describe("AskVVoiceIndicator", () => {
  it("keeps the app-wide mute control visible on Gate while AskV starts", () => {
    const screen = render(<AskVVoiceIndicator />);
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-color")).toBe("#b51a2a");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("false");
    expect(screen.getByText("AskV is Muted")).toBeTruthy();
    fireEvent.click(screen.getByTestId("askv-global-mute"));
    expect(env.setMuted).toHaveBeenCalledWith(false);
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("uses the active pill only while the voice session is working", () => {
    env.voice.state = "listening";
    const screen = render(<AskVVoiceIndicator />);

    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("false");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-color")).toBe("#1f9a3d");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-source")).toContain("pill_green_approval1.png");
    expect(screen.getByText("AskV is Active")).toBeTruthy();
  });

  it("uses the gray pill when voice is unavailable", () => {
    env.voice.state = "error";
    const screen = render(<AskVVoiceIndicator />);

    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("true");
    expect(screen.getByText("AskV is Unavailable")).toBeTruthy();
  });

  it("moves the AskV voice control into the dashboard header without leaving a duplicate overlay", () => {
    env.pathname = "/change-over";

    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();

    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
    const waveform = inlineScreen.getByTestId("askv-waveform");
    expect(waveform.getAttribute("aria-label")).toBe("Ask V voice idle");
    expect(waveform.closest('[data-testid="askv-global-mute"]')).not.toBeNull();
    fireEvent.click(inlineScreen.getByTestId("askv-global-mute"));
    expect(env.setMuted).toHaveBeenCalledWith(false);
  });
});
