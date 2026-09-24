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
  it("moves the AskV voice control into the AskV title row without leaving a duplicate overlay", () => {
    env.pathname = "/askv";

    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();

    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
    expect(inlineScreen.getByText("AskV is Muted")).toBeTruthy();
  });

  it("moves the AskV voice control into the Gate header without leaving a duplicate overlay", () => {
    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();

    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
    expect(inlineScreen.getByText("AskV is Muted")).toBeTruthy();
    fireEvent.click(inlineScreen.getByTestId("askv-global-mute"));
    expect(env.setMuted).toHaveBeenCalledWith(false);
  });

  it("uses the active pill only while the voice session is working", () => {
    env.pathname = "/schedule";
    env.voice.state = "listening";
    const screen = render(<AskVVoiceIndicator />);

    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("false");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-color")).toBe("#1f9a3d");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-source")).toContain("pill_green_approval1.png");
    expect(screen.getByText("AskV is Active")).toBeTruthy();
    expect(screen.getByText("AskV is Active").getAttribute("style")).toContain("color: rgb(255, 255, 255)");
    expect(screen.getByTestId("askv-waveform").firstElementChild?.getAttribute("style")).toContain("background-color: rgb(255, 255, 255)");
  });

  it("uses the gray pill when voice is unavailable", () => {
    env.pathname = "/schedule";
    env.voice.state = "error";
    const screen = render(<AskVVoiceIndicator />);

    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("true");
    expect(screen.getByText("AskV is Unavailable")).toBeTruthy();
    expect(screen.getByText("AskV is Unavailable").getAttribute("style")).toContain("color: rgb(26, 29, 35)");
    expect(screen.getByText("AskV is Unavailable").getAttribute("style")).toContain("font-size: 14px");
    expect(screen.getByTestId("askv-waveform").firstElementChild?.getAttribute("style")).toContain("background-color: rgb(26, 29, 35)");
  });

  it("uses the gray pill and waveform when voice is muted", () => {
    env.pathname = "/schedule";
    env.voice.state = "stopped";
    env.voice.muted = true;
    const screen = render(<AskVVoiceIndicator />);

    expect(screen.getByTestId("askv-global-mute").getAttribute("data-inactive")).toBe("true");
    expect(screen.getByTestId("askv-global-mute").getAttribute("data-color")).toBe("brand");
    expect(screen.getByText("AskV is Muted")).toBeTruthy();
    expect(screen.getByTestId("askv-waveform")).toBeTruthy();
  });

  it("moves the AskV voice control into the dashboard header without leaving a duplicate overlay", () => {
    env.pathname = "/change-over";

    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();

    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
    expect(inlineScreen.getByTestId("askv-inline-status").getAttribute("style")).toContain("align-items: flex-end");
    expect(inlineScreen.getByTestId("askv-inline-status").getAttribute("style")).not.toContain("width: 50%");
    const waveform = inlineScreen.getByTestId("askv-waveform");
    expect(waveform.getAttribute("aria-label")).toBe("Ask V voice idle");
    expect(waveform.closest('[data-testid="askv-global-mute"]')).not.toBeNull();
    fireEvent.click(inlineScreen.getByTestId("askv-global-mute"));
    expect(env.setMuted).toHaveBeenCalledWith(false);
  });

  it("moves the AskV voice control into Work Hub page headers without leaving a duplicate overlay", () => {
    env.pathname = "/work-hub/activity";
    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();
    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
  });

  it.each(["/gate-history", "/notifications", "/gate-notifications", "/notification-preferences", "/gate-notification-preferences", "/profile", "/edit-profile", "/compliance"])("moves the AskV voice control into the %s header without leaving a duplicate overlay", (pathname) => {
    env.pathname = pathname;
    const globalScreen = render(<AskVVoiceIndicator />);
    expect(globalScreen.queryByTestId("askv-global-status")).toBeNull();
    globalScreen.unmount();
    const inlineScreen = render(<AskVVoiceIndicator inline />);
    expect(inlineScreen.getByTestId("askv-inline-status")).toBeTruthy();
  });
});
