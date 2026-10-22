import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import OnCallPill from "./OnCallPill";
const m = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), current: true }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => m.current }));
vi.mock("@/lib/native-operations", () => ({ readNativeOperations: m.read, changeNativeOnCall: m.change }));
vi.mock("./WorkdayStatusText", () => ({ default: ({ active, label, disabled, onPress }: any) => <button aria-pressed={active} disabled={disabled} onClick={onPress}>{label}</button> }));
beforeEach(() => { m.current = true; m.read.mockReset(); m.change.mockReset(); m.read.mockResolvedValue({ policy: { enabled: true }, onCallActive: false }); m.change.mockResolvedValue({ policy: { enabled: true }, onCallActive: true }); });
it("preserves independent on-call consent when a shift is active", async () => {
  render(<OnCallPill shiftActive />);
  const control = screen.getByRole("button", { name: "Not on Call" });
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false)); fireEvent.click(control);
  expect(await screen.findByRole("button", { name: "On Call" })).toBeTruthy();
  expect(m.change).toHaveBeenCalledWith(true, true);
});
it("does not submit a declaration after the signed-in account changes", async () => {
  render(<OnCallPill shiftActive={false} />);
  const control = screen.getByRole("button", { name: "Not on Call" });
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false)); m.current = false; fireEvent.click(control);
  expect(m.change).not.toHaveBeenCalled();
});
