import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
const mock = vi.hoisted(() => ({
  switchContext: vi.fn(),
  replace: vi.fn(),
  revoke: vi.fn(),
  stop: vi.fn(),
  native: vi.fn(),
  decline: vi.fn(),
  language: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn(), replace: mock.replace },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 1, role: "field_employee", vendorRole: "gatekeeper" },
    activeMembershipId: 1,
    activeMembership: { id: 1, orgName: "First company" },
    availableMemberships: [
      { id: 1, role: "member", orgName: "First company" },
      { id: 2, role: "member", orgName: "Second company" },
    ],
    switchContext: mock.switchContext,
  }),
}));
vi.mock("@/hooks/use-gate-query", () => ({
  useGateQuery: () => ({
    data: {
      firstName: "Gate",
      lastName: "Keeper",
      email: "gate@example.invalid",
    },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/gate/GateChrome", () => ({
  useGateCopy: () => (en: string) => en,
  gateStyle: { text: {}, muted: {} },
  GatePage: ({ children }: any) => <main>{children}</main>,
  GateCard: ({ children }: any) => <section>{children}</section>,
  GateRow: ({ label, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  GateError: ({ message }: any) =>
    message ? <div role="alert">{message}</div> : null,
  GateLoading: () => null,
}));
vi.mock("@/components/ProfilePhotoImage", () => ({ default: () => null }));
vi.mock("@/components/WorkHubDeviceSettings", () => ({ default: () => null }));
vi.mock("@/components/work-hub/NativeOperations", () => ({
  default: () => null,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, ...p }: any) => (
    <button onClick={p.onPress} disabled={p.disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/api", () => ({
  logout: vi.fn(),
  updatePreferredLanguage: mock.language,
}));
vi.mock("@/lib/i18n", () => ({ setLanguage: vi.fn() }));
vi.mock("@/lib/locationConsent", () => ({
  revokeConsent: mock.revoke,
  setConsentDeclined: mock.decline,
}));
vi.mock("@/lib/liveLocationReporter", () => ({
  stopLiveLocationReporter: mock.stop,
}));
vi.mock("@/lib/native-operations", () => ({
  updateNativeConsent: mock.native,
}));
import Profile from "../(tabs)/profile";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("switches company using server context and returns to the Gate dashboard", async () => {
  render(<Profile />);
  expect(
    (
      screen.getByRole("button", {
        name: "✓ First company",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Second company" }));
  await waitFor(() => expect(mock.switchContext).toHaveBeenCalledWith(2));
  await waitFor(() =>
    expect(mock.replace).toHaveBeenCalledWith("/change-over"),
  );
});
it("surfaces failed company changes without navigating", async () => {
  mock.switchContext.mockRejectedValueOnce(new Error("Access changed"));
  render(<Profile />);
  fireEvent.click(screen.getByRole("button", { name: "Second company" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Access changed",
  );
  expect(mock.replace).not.toHaveBeenCalled();
});
it("stops both location systems instead of only hiding the indicator", async () => {
  render(<Profile />);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop sharing live location" }),
  );
  await waitFor(() => expect(mock.native).toHaveBeenCalledWith(false));
  expect(mock.stop).toHaveBeenCalled();
  expect(mock.revoke).toHaveBeenCalled();
  expect(mock.decline).toHaveBeenCalledWith(true);
});
