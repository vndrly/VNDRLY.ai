import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OnCallPill from "./OnCallPill";
const m = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), current: true }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => m.current }));
vi.mock("@/lib/native-operations", () => ({ readNativeOperations: m.read, changeNativeOnCall: m.change }));
afterEach(cleanup);
beforeEach(() => { m.current = true; m.read.mockReset(); m.change.mockReset(); m.read.mockResolvedValue({ policy: { enabled: true }, onCallActive: false }); m.change.mockResolvedValue({ policy: { enabled: true }, onCallActive: true }); });
it("preserves independent on-call consent when a shift is active", async () => {
  await act(async () => { render(<OnCallPill shiftActive />); });
  const control = screen.getByRole("switch", { name: "On Call" });
  await waitFor(() => expect(control.getAttribute("aria-disabled")).not.toBe("true")); fireEvent.click(control);
  await waitFor(() => expect(m.change).toHaveBeenCalledWith(true, true));
  await waitFor(() => expect(screen.getByRole("switch", { name: "On Call" }).getAttribute("aria-checked")).toBe("true"));
  expect(m.change).toHaveBeenCalledWith(true, true);
});
it("does not submit a declaration after the signed-in account changes", async () => {
  await act(async () => { render(<OnCallPill shiftActive={false} />); });
  const control = screen.getByRole("switch", { name: "On Call" });
  await waitFor(() => expect(control.getAttribute("aria-disabled")).not.toBe("true")); m.current = false; fireEvent.click(control);
  expect(m.change).not.toHaveBeenCalled();
});
