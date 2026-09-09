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
import LiveConnectionPill from "./live-connection-pill";

describe("AskVStatusIndicator", () => {
  beforeEach(() => { setMuted.mockClear(); voice.muted = true; voice.state = "idle"; voice.wakeReady = false; voice.availabilityStatus = "available"; });

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

  it("uses a gray restart pill in the top strip without changing the approved modal control", () => {
    const { rerender } = render(<AskVStatusIndicator placement="top-strip" />);
    const topStripButton = screen.getByRole("button", { name: "Click to restart V" });
    expect(topStripButton.getAttribute("data-color")).toBe("grey");
    expect(topStripButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(topStripButton);
    expect(setMuted).toHaveBeenCalledWith(false);

    rerender(<AskVStatusIndicator />);
    const modalButton = screen.getByRole("button", { name: "Go Live with AskV" });
    expect(modalButton.className).toContain("min-w-[74px]");
    expect(modalButton.className).toContain("-translate-y-1");
  });
  it("matches the Hotlist Live pill artwork and height when V is listening", () => {
    voice.muted = false; voice.state = "listening";
    render(<><AskVStatusIndicator placement="top-strip" /><LiveConnectionPill status="live" /></>);
    const button = screen.getByRole("button", { name: "V is listening" });
    const hotlist = screen.getByTestId("live-connection-pill");
    expect(button.querySelector("img")!.getAttribute("src")).toBe(hotlist.querySelector("img")!.getAttribute("src"));
    expect(button.style.height).toBe(hotlist.style.height);
    expect(button.getAttribute("data-color")).toBe("green");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
  });
  it("offers restart instead of claiming listening when unmuted but disconnected", () => {
    voice.muted = false; voice.state = "stopped";
    render(<AskVStatusIndicator placement="top-strip" />);
    fireEvent.click(screen.getByRole("button", { name: "Click to restart V" }));
    expect(setMuted).toHaveBeenCalledWith(false);
  });
});
