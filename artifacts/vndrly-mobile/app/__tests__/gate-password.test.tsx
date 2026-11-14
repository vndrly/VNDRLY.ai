import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  refresh: vi.fn(),
  token: vi.fn(),
  clear: vi.fn(),
  replace: vi.fn(),
  current: true,
}));
vi.mock("expo-router", () => ({ router: { replace: m.replace } }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { displayName: "Test", mustChangePassword: true } }),
}));
vi.mock("@/lib/api", () => ({
  apiFetch: m.api,
  refreshAuthMe: m.refresh,
  logout: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
  setToken: m.token,
}));
vi.mock("@/lib/biometrics", () => ({ clearBiometricCredentials: m.clear }));
vi.mock("@/lib/gate-handoff-return", () => ({
  takeGateHandoffDestination: () => "/handoff?siteId=1",
}));
vi.mock("@/components/gate/GateChrome", () => ({
  useGateCopy: () => (en: string) => en,
  gateStyle: {},
  GatePage: ({ children }: any) => <div>{children}</div>,
  GateCard: ({ children }: any) => <div>{children}</div>,
  GateError: ({ message }: any) => <div role="alert">{message}</div>,
  GateField: ({ label, value, onChangeText }: any) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
import GatePassword from "../gate-password";
beforeEach(() => {
  vi.clearAllMocks();
  m.current = true;
  m.api.mockResolvedValue({ ok: true, token: "rotated" });
  m.refresh.mockResolvedValue({ mustChangePassword: false });
});
afterEach(cleanup);
function fill() {
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "NewTestPassword!" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "NewTestPassword!" },
  });
  fireEvent.click(screen.getByText("Save password and continue"));
}
it("requires matching passwords before a write", () => {
  render(<GatePassword />);
  fireEvent.click(screen.getByText("Save password and continue"));
  expect(m.api).not.toHaveBeenCalled();
});
it("installs the rotated token and verifies completion before returning to handoff", async () => {
  render(<GatePassword />);
  fill();
  await waitFor(() =>
    expect(m.replace).toHaveBeenCalledWith("/handoff?siteId=1"),
  );
  expect(m.token).toHaveBeenCalledWith("rotated");
  expect(m.clear).toHaveBeenCalledTimes(1);
  expect(m.refresh).toHaveBeenCalledTimes(1);
});
it("does not claim enrollment completion when readback fails", async () => {
  m.refresh.mockResolvedValue(null);
  render(<GatePassword />);
  fill();
  await screen.findByText(/Sign out and sign in again/);
  expect(m.replace).not.toHaveBeenCalled();
});
it("discards a completion that belongs to a changed account", async () => {
  m.api.mockImplementation(async () => {
    m.current = false;
    return { ok: true, token: "wrong-account" };
  });
  render(<GatePassword />);
  fill();
  await waitFor(() => expect(m.api).toHaveBeenCalled());
  expect(m.token).not.toHaveBeenCalled();
});
