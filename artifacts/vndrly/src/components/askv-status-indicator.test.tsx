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
import { pillGreenApproval1 } from "@/lib/pill-palette-assets";

describe("AskVStatusIndicator", () => {
  beforeEach(() => { setMuted.mockClear(); voice.muted = true; voice.state = "idle"; voice.wakeReady = false; voice.availabilityStatus = "available"; });

  it("turns natural voice on directly from the Muted control", () => {
    const { container } = render(<AskVStatusIndicator />);
    const button = screen.getByRole("button", { name: "Click to Start V" });
    expect(button.textContent).toContain("Click to Start V");
    expect(button.getAttribute("data-color")).toBe("green");
    expect(button.className).toContain("h-[23px]");
    expect(button.className).toContain("self-center");
    expect([...container.querySelectorAll("img")]).toHaveLength(3);
    expect([...container.querySelectorAll("img")].every((image) => image.getAttribute("src") === pillGreenApproval1)).toBe(true);
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it("mutes natural voice directly from the active control", () => {
    voice.muted = false;
    voice.state = "listening";
    render(<AskVStatusIndicator />);
    const button = screen.getByRole("button", { name: "Click to Mute V" });
    expect(button.textContent).toContain("Click to Mute V");
    expect(button.getAttribute("data-color")).toBe("red");
    expect(button.className).toContain("h-[23px]");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
    voice.muted = true;
    voice.state = "idle";
  });

  it("does not underline or draw a focus halo around the shared control", () => {
    render(<AskVStatusIndicator />);
    const toggle = screen.getByRole("button", { name: "Click to Start V" });

    expect(toggle.className).not.toContain("underline");
    expect(toggle.className).toContain("focus-visible:outline-none");
  });

  it("uses the same green Start and red Mute labels in the top strip and modal", () => {
    const { rerender } = render(<AskVStatusIndicator placement="top-strip" />);
    const topStripButton = screen.getByRole("button", { name: "Click to Start V" });
    expect(topStripButton.getAttribute("data-color")).toBe("green");
    expect(topStripButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(topStripButton);
    expect(setMuted).toHaveBeenCalledWith(false);

    rerender(<AskVStatusIndicator />);
    const modalButton = screen.getByRole("button", { name: "Click to Start V" });
    expect(modalButton.className).toBe(topStripButton.className);
  });
  it("uses the red Mute pill when V is listening", () => {
    voice.muted = false; voice.state = "listening";
    render(<AskVStatusIndicator placement="top-strip" />);
    const button = screen.getByRole("button", { name: "Click to Mute V" });
    expect(button.getAttribute("data-color")).toBe("red");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
    const waveform = screen.getByTestId("askv-waveform");
    expect(waveform.getAttribute("data-active")).toBe("true");
    expect(waveform.closest("button")).toBe(button);
  });
  it("keeps the shared toggle on Mute while voice is unmuted but disconnected", () => {
    voice.muted = false; voice.state = "stopped";
    render(<AskVStatusIndicator placement="top-strip" />);
    fireEvent.click(screen.getByRole("button", { name: "Click to Mute V" }));
    expect(setMuted).toHaveBeenCalledWith(true);
  });
  it("opens the shared Ask V panel when either top control is used", () => {
    const listener = vi.fn();
    window.addEventListener("askv:open-panel", listener);
    render(<AskVStatusIndicator placement="top-strip" />);
    fireEvent.click(screen.getByRole("button", { name: "Click to Start V" }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("askv:open-panel", listener);
  });
});
