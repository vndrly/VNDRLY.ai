import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AskVWaveform from "./askv-waveform";
import { readAskVWaveform } from "@/lib/askv-audio-waveform";

vi.mock("@/lib/askv-audio-waveform", () => ({ readAskVWaveform: vi.fn() }));
afterEach(() => vi.useRealTimers());

it("stays flat for silence, responds to captured sound, and resets when stopped", () => {
  vi.useFakeTimers();
  vi.mocked(readAskVWaveform).mockReturnValue(new Float32Array(256));
  const { rerender } = render(<AskVWaveform active />);
  const bars = () => Array.from(screen.getByTestId("askv-waveform").children) as HTMLElement[];
  act(() => vi.advanceTimersByTime(80));
  expect(bars().every(bar => bar.style.height === "4px")).toBe(true);
  vi.mocked(readAskVWaveform).mockReturnValue(new Float32Array(256).fill(0.125));
  act(() => vi.advanceTimersByTime(80));
  expect(bars()[2].style.height).toBe("20px");
  rerender(<AskVWaveform active={false} />);
  expect(bars().every(bar => bar.style.height === "4px")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
