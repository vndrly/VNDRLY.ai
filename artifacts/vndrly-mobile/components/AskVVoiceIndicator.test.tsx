import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  navigate: vi.fn(),
  setMuted: vi.fn(),
  voice: {
    preferencesReady: true,
    state: "stopped",
    muted: false,
  },
}));

vi.mock("expo-router", () => ({
  router: { push: env.navigate },
  usePathname: () => "/gate",
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
  default: ({ children, onPress, testID }: { children: React.ReactNode; onPress: () => void; testID?: string }) => (
    <Text onPress={onPress} testID={testID}>{children}</Text>
  ),
}));

import AskVVoiceIndicator from "./AskVVoiceIndicator";

afterEach(() => {
  cleanup();
  env.navigate.mockReset();
  env.setMuted.mockReset();
});

describe("AskVVoiceIndicator", () => {
  it("keeps the app-wide mute control visible on Gate while AskV starts", () => {
    const screen = render(<AskVVoiceIndicator />);
    fireEvent.click(screen.getByTestId("askv-global-mute"));
    expect(env.setMuted).toHaveBeenCalledWith(true);
    expect(env.navigate).not.toHaveBeenCalled();
  });
});
