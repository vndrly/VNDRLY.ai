import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { GateMapTimeControl, formatGateMapTime } from "./gate-map-time-control";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function Control() {
  const [instant, setInstant] = useState<string | null>(null);
  return <GateMapTimeControl instant={instant} onChange={setInstant} liveConnected />;
}
it("ticks only its live wall clock, always in Central Time with seconds and AM/PM", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T23:57:01Z"));
  const change = vi.fn();
  render(<GateMapTimeControl instant={null} onChange={change} liveConnected />);
  expect(screen.getByLabelText("Coverage clock").textContent).toBe("10/28/26, 6:57:01 PM CT");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByLabelText("Coverage clock").textContent).toBe("10/28/26, 6:57:03 PM CT");
  expect(change).not.toHaveBeenCalled();
  expect(formatGateMapTime("2026-01-15T18:00:00Z")).toBe("01/15/26, 12:00:00 PM CT");
  expect(formatGateMapTime("2026-07-15T18:00:00Z")).toBe("07/15/26, 1:00:00 PM CT");
});
it("opens Day of, interprets the selection in Central Time, freezes the same clock and resets live", () => {
  vi.stubEnv("TZ", "Asia/Tokyo");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T23:57:01Z"));
  render(<Control />);
  const clock = screen.getByLabelText("Coverage clock");
  expect(within(screen.getByLabelText("Coverage time controls")).queryByRole("button", { name: "RESET" })).toBeNull();
  expect(screen.queryByLabelText("Date and time (Central Time)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-10-27T10:30" } });
  expect(screen.getByLabelText("Coverage clock")).toBe(clock);
  expect(clock.getAttribute("dateTime")).toBe("2026-10-27T15:30:00.000Z");
  expect(clock.textContent).toBe("10/27/26, 10:30:00 AM CT");
  act(() => vi.advanceTimersByTime(3000));
  expect(clock.textContent).toBe("10/27/26, 10:30:00 AM CT");
  fireEvent.click(within(screen.getByLabelText("Coverage time controls")).getByRole("button", { name: "RESET" }));
  expect(clock.textContent).toBe("10/28/26, 6:57:04 PM CT");
  expect(screen.queryByLabelText("Date and time (Central Time)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  expect((screen.getByLabelText("Date and time (Central Time)") as HTMLInputElement).value).not.toContain("2026-10-27");
});
it("Live performs the same reset while the picker is open and hides the external Reset link", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T23:57:01Z"));
  render(<Control />);
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-10-27T10:30" } });
  expect(within(screen.getByLabelText("Coverage time controls")).getByRole("button", { name: "RESET" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /^reset$/i })).toBeNull();
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")).toBe("true");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByLabelText("Coverage clock").textContent).toBe("10/28/26, 6:57:02 PM CT");
});
it("picker Reset clears the draft and selection, resumes ticking and closes the picker", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T23:57:01Z"));
  render(<Control />);
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-10-27T10:30" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Live")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByLabelText("Coverage clock").textContent).toBe("10/28/26, 6:57:02 PM CT");
});
it("rejects nonexistent Central times and lets repeated DST times be selected explicitly", () => {
  render(<Control />);
  fireEvent.click(screen.getByRole("button", { name: "Day of" }));
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-03-08T02:30" } });
  expect(screen.getByRole("alert").textContent).toMatch(/does not exist/);
  fireEvent.input(screen.getByLabelText("Date and time (Central Time)"), { target: { value: "2026-11-01T01:30" } });
  const occurrence = screen.getByLabelText("Repeated Central time");
  fireEvent.change(occurrence, { target: { value: "2026-11-01T07:30:00.000Z" } });
  expect(screen.getByLabelText("Coverage clock").getAttribute("dateTime")).toBe("2026-11-01T07:30:00.000Z");
});
