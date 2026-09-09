import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setMuted = vi.fn();
const voice = {
  state: "idle",
  muted: true,
  acrossVndrly: false,
  wakeReady: false,
  error: null,
  availabilityStatus: "available",
  setMuted,
};

vi.mock("@/hooks/use-askv-voice-session", () => ({
  useAskVVoiceSession: () => voice,
}));

import AskVStatusIndicator from "./askv-status-indicator";

describe("AskVStatusIndicator", () => {
  beforeEach(() => setMuted.mockClear());

  it("turns natural voice on directly from the Muted control", () => {
    render(<AskVStatusIndicator />);
    fireEvent.click(screen.getByRole("button", { name: "Unmute AskV" }));
    expect(screen.getByTestId("askv-status-indicator").textContent).toContain("Unmute");
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it("mutes natural voice directly from the Live control", () => {
    voice.muted = false;
    voice.state = "listening";
    render(<AskVStatusIndicator />);
    expect(screen.getByTestId("askv-status-indicator").textContent).toContain("Mute");
    fireEvent.click(screen.getByRole("button", { name: "Mute AskV" }));
    expect(setMuted).toHaveBeenCalledWith(true);
    voice.muted = true;
    voice.state = "idle";
  });

  it("does not draw a focus halo around the mute control", () => {
    render(<AskVStatusIndicator />);
    const toggle = screen.getByRole("button", { name: "Unmute AskV" });

    expect(toggle.className).toContain("focus-visible:ring-0");
    expect(toggle.className).toContain("focus-visible:ring-offset-0");
    expect(toggle.className).toContain("focus-visible:outline-none");
  });
});
