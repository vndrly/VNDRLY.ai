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
import { pillGreenApproval1, PILL_IDLE } from "@/lib/pill-palette-assets";

describe("AskVStatusIndicator", () => {
  beforeEach(() => { setMuted.mockClear(); voice.muted = true; voice.state = "idle"; voice.wakeReady = false; voice.availabilityStatus = "available"; });

  it("turns natural voice on directly from the Muted control", () => {
    const { container } = render(<AskVStatusIndicator />);
    const button = screen.getByRole("button", { name: "AskV is Muted" });
    expect(button.textContent).toContain("AskV is Muted");
    expect(button.getAttribute("data-color")).toBe("grey");
    expect(button.className).toContain("h-[23px]");
    expect(button.className).toContain("self-center");
    expect([...container.querySelectorAll("img")]).toHaveLength(3);
    expect([...container.querySelectorAll("img")].every((image) => image.getAttribute("src") === PILL_IDLE)).toBe(true);
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it("mutes natural voice directly from the active control", () => {
    voice.muted = false;
    voice.state = "listening";
    render(<AskVStatusIndicator />);
    const button = screen.getByRole("button", { name: "AskV is Active" });
    expect(button.textContent).toContain("AskV is Active");
    expect(button.getAttribute("data-color")).toBe("green");
    expect(button.className).toContain("h-[23px]");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
    voice.muted = true;
    voice.state = "idle";
  });

  it("does not underline or draw a focus halo around the shared control", () => {
    render(<AskVStatusIndicator />);
    const toggle = screen.getByRole("button", { name: "AskV is Muted" });

    expect(toggle.className).not.toContain("underline");
    expect(toggle.className).toContain("focus-visible:outline-none");
  });

  it("uses the same inactive and active voice colors in the top strip and modal", () => {
    const { rerender } = render(<AskVStatusIndicator placement="top-strip" />);
    const topStripButton = screen.getByRole("button", { name: "AskV is Muted" });
    expect(topStripButton.getAttribute("data-color")).toBe("grey");
    expect(topStripButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(topStripButton);
    expect(setMuted).toHaveBeenCalledWith(false);

    rerender(<AskVStatusIndicator />);
    const modalButton = screen.getByRole("button", { name: "AskV is Muted" });
    expect(modalButton.className).toBe(topStripButton.className);
  });
  it("uses the green pill when V is listening", () => {
    voice.muted = false; voice.state = "listening";
    render(<AskVStatusIndicator placement="top-strip" />);
    const button = screen.getByRole("button", { name: "AskV is Active" });
    expect(button.getAttribute("data-color")).toBe("green");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(true);
    const waveform = screen.getByTestId("askv-waveform");
    expect(waveform.getAttribute("data-active")).toBe("true");
    expect(waveform.closest("button")).toBe(button);
  });
  it("shows the disconnected voice as an inactive Start control", () => {
    voice.muted = false; voice.state = "stopped";
    render(<AskVStatusIndicator placement="top-strip" />);
    const button = screen.getByRole("button", { name: "AskV is Muted" });
    expect(button.getAttribute("data-color")).toBe("grey");
    fireEvent.click(button);
    expect(setMuted).toHaveBeenCalledWith(false);
  });
  it("uses the gray pill when voice is unavailable", () => {
    voice.availabilityStatus = "unavailable";
    const { container } = render(<AskVStatusIndicator placement="top-strip" />);
    const button = screen.getByRole("button", { name: "AskV is Unavailable" });
    expect(button.getAttribute("data-color")).toBe("grey");
    expect([...container.querySelectorAll("img")].every((image) => image.getAttribute("src") === PILL_IDLE)).toBe(true);
  });
  it("opens the shared Ask V panel when either top control is used", () => {
    const listener = vi.fn();
    window.addEventListener("askv:open-panel", listener);
    render(<AskVStatusIndicator placement="top-strip" />);
    fireEvent.click(screen.getByRole("button", { name: "AskV is Muted" }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("askv:open-panel", listener);
  });

  it("waits for an established session before showing active status", () => {
    voice.muted = false;
    voice.state = "connecting";
    const { rerender } = render(<AskVStatusIndicator placement="top-strip" />);
    const connecting = screen.getByRole("button", { name: "AskV is Connecting" });
    expect(connecting.getAttribute("data-color")).toBe("grey");
    expect(connecting.getAttribute("aria-pressed")).toBe("false");
    expect(connecting.title).toBe("Stop AskV voice");
    expect(screen.getByTestId("askv-waveform").getAttribute("data-active")).toBe("false");

    voice.state = "listening";
    rerender(<AskVStatusIndicator placement="top-strip" />);
    const listening = screen.getByRole("button", { name: "AskV is Active" });
    expect(listening.getAttribute("data-color")).toBe("green");
    expect(listening.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("askv-waveform").getAttribute("data-active")).toBe("true");
  });

  describe.each([
    ["VNDRLY light", "light", "#F59E0B"],
    ["vendor dark", "dark", "#008578"],
    ["partner light", "light", "#3260CD"],
  ])("%s brand mode", (_name, mode, primary) => {
    it.each([
      ["idle", true, "available", "Muted", "grey", false, "Start", false],
      ["listening", true, "available", "Muted", "grey", false, "Start", false],
      ["idle", false, "available", "Muted", "grey", false, "Start", false],
      ["stopped", false, "available", "Muted", "grey", false, "Start", false],
      ["listening", false, "unavailable", "Unavailable", "grey", false, "Retry", false],
      ["error", false, "available", "Unavailable", "grey", false, "Retry", false],
      ["connecting", false, "available", "Connecting", "grey", false, "Stop", true],
      ["connecting", true, "available", "Muted", "grey", false, "Start", false],
      ["connecting", false, "unavailable", "Unavailable", "grey", false, "Retry", false],
      ["greeting", false, "available", "Active", "green", true, "Mute", true],
      ["listening", false, "available", "Active", "green", true, "Mute", true],
      ["thinking", false, "available", "Active", "green", true, "Mute", true],
      ["speaking", false, "available", "Active", "green", true, "Mute", true],
      ["wake-idle", false, "available", "Active", "green", true, "Mute", true],
    ] as const)("renders %s (muted=%s, availability=%s) with its semantic status", (state, muted, availability, status, tone, active, action, mutedAfterClick) => {
      Object.assign(voice, { state, muted, availabilityStatus: availability });
      const { container } = render(
        <div className={mode} style={{ "--brand-primary": primary } as React.CSSProperties}>
          <AskVStatusIndicator placement="top-strip" />
        </div>,
      );

      const button = screen.getByRole("button", { name: `AskV is ${status}` });
      expect(button.textContent).toContain(`AskV is ${status}`);
      expect(button.getAttribute("data-color")).toBe(tone);
      expect(button.getAttribute("aria-pressed")).toBe(String(active));
      expect(button.title).toBe(`${action} AskV voice`);
      const images = [...button.querySelectorAll("img")];
      expect(images).toHaveLength(3);
      expect(images.every((image) => image.getAttribute("src") === (active ? pillGreenApproval1 : PILL_IDLE))).toBe(true);
      expect(screen.getByRole("img", { name: active ? "Ask V voice activity" : "Ask V voice idle" }).getAttribute("data-active")).toBe(String(active));
      expect(container.querySelectorAll("button")).toHaveLength(1);
      fireEvent.click(button);
      expect(setMuted).toHaveBeenCalledWith(mutedAfterClick);
    });
  });
});
