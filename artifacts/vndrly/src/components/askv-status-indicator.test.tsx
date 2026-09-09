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
    const button = screen.getByRole("button", { name: "Go Live with AskV" });
    expect(button.textContent).toContain("Go Live");
    expect(button.getAttribute("data-color")).toBe("green");
    expect(button.className).toContain("h-[34px]");
    expect(button.className).toContain("min-w-[74px]");
    expect(button.className).toContain("self-center");
    expect(button.className).toContain("-translate-y-1");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it("mutes natural voice directly from the Live control", () => {
    voice.muted = false;
    voice.state = "listening";
    render(<AskVStatusIndicator />);
    const button = screen.getByRole("button", { name: "Mute AskV" });
    expect(button.textContent).toContain("Mute");
    expect(button.getAttribute("data-color")).toBe("red");
    expect(button.className).toContain("h-[34px]");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
    voice.muted = true;
    voice.state = "idle";
  });

  it("does not draw a focus halo around the mute control", () => {
    render(<AskVStatusIndicator />);
    const toggle = screen.getByRole("button", { name: "Go Live with AskV" });

    expect(toggle.className).toContain("focus-visible:ring-0");
    expect(toggle.className).toContain("focus-visible:ring-offset-0");
    expect(toggle.className).toContain("focus-visible:outline-none");
  });

  it("uses the narrower vertically-centered treatment only in the top strip", () => {
    const { rerender } = render(<AskVStatusIndicator placement="top-strip" />);
    const topStripButton = screen.getByRole("button", { name: "Go Live with AskV" });
    expect(topStripButton.className).toContain("min-w-[62px]");
    expect(topStripButton.className).toContain("translate-y-0");

    rerender(<AskVStatusIndicator />);
    const modalButton = screen.getByRole("button", { name: "Go Live with AskV" });
    expect(modalButton.className).toContain("min-w-[74px]");
    expect(modalButton.className).toContain("-translate-y-1");
  });
});
