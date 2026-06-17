import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #498 — UI coverage for the mobile adjacent-ticket flow on
// new-ticket.tsx. Two specific behaviors that the server-side tests
// can't see: (1) when launched in adjacent mode the screen fetches
// /api/field/me + /api/field/foremen and renders a foreman picker
// defaulting to "self"; (2) submitting the form forwards the picked
// foremanUserId on the POST body — and ONLY the picked one (so a
// non-adjacent flow never accidentally forwards a foreman).

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    primaryForeground: "#fff",
    accent: "#fef3c7",
    accentForeground: "#92400e",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const { routerReplaceMock, useLocalSearchParamsMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  useLocalSearchParamsMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  router: { replace: routerReplaceMock, push: vi.fn(), back: vi.fn() },
  useLocalSearchParams: () => useLocalSearchParamsMock(),
}));

const tIdentity = (k: string) => k;
const useTranslationReturn = { t: tIdentity };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
}));

const fieldEmployeeUser = {
  userId: 42,
  role: "field_employee" as const,
  vendorId: 11,
  vendorRole: "field" as const,
  displayName: "Field Op",
  partnerId: null,
  preferredLanguage: "en" as const,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: fieldEmployeeUser,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
  }),
}));

const {
  requestForegroundPermissionsAsyncMock,
  getCurrentPositionAsyncMock,
} = vi.hoisted(() => ({
  requestForegroundPermissionsAsyncMock: vi.fn(),
  getCurrentPositionAsyncMock: vi.fn(),
}));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...a: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...a),
  getCurrentPositionAsync: (...a: unknown[]) =>
    getCurrentPositionAsyncMock(...a),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

vi.mock("@/components/AmberButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      disabled,
      loading,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
      testID?: string;
    }) => {
      const isDisabled = !!(disabled || loading);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": testID,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
        },
        typeof children === "string" ? children : "btn",
      );
    },
  };
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import NewTicketScreen from "../new-ticket";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
});

const SITE = {
  id: 11,
  name: "Acme Site",
  address: "111 St",
  state: "TX",
  siteCode: "ACME-1",
  partnerName: "Acme Partner",
};
const WORK_TYPE = { id: 7, name: "Maintenance", category: null };
const ME = {
  employeeId: 555,
  userId: 1234,
  firstName: "Alice",
  lastName: "Field",
  vendorId: 99,
};
const FOREMEN = [
  // Self appears in the foremen list (a foreman can self-create); the
  // picker should suppress this duplicate so only the explicit "self"
  // chip is rendered for user 1234.
  { vendorPersonId: 555, userId: 1234, firstName: "Alice", lastName: "Field" },
  { vendorPersonId: 777, userId: 5555, firstName: "Bob", lastName: "Boss" },
];

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function setupApiFetch() {
  apiFetchMock.mockImplementation(
    (url: string, opts?: { method?: string; body?: string }) => {
      if (url === "/api/field/sites") return Promise.resolve([SITE]);
      if (url === "/api/field/sites/11/work-types")
        return Promise.resolve([WORK_TYPE]);
      if (url === "/api/field/me") return Promise.resolve(ME);
      if (url === "/api/field/foremen") return Promise.resolve(FOREMEN);
      if (url === "/api/field/tickets" && opts?.method === "POST")
        return Promise.resolve({ id: 9001 });
      return Promise.resolve(null);
    },
  );
}

describe("NewTicketScreen — adjacent-ticket foreman picker (Task #498)", () => {
  it("renders the foreman picker only in adjacent mode and defaults to self", async () => {
    useLocalSearchParamsMock.mockReturnValue({ siteId: "11", adjacent: "1" });
    setupApiFetch();
    render(<NewTicketScreen />);
    // The picker is gated on `isAdjacent` AND on /api/field/me +
    // /api/field/foremen resolving — so wait for the picker container
    // to appear before asserting on its contents.
    const picker = await screen.findByTestId("foreman-picker");
    expect(picker).toBeTruthy();
    // Self chip is always present and selected by default.
    const selfChip = screen.getByTestId("foreman-self");
    expect(selfChip.textContent).toContain("Alice Field");
    // Other foreman is rendered.
    expect(screen.getByTestId("foreman-5555")).toBeTruthy();
    // Self's duplicate entry in the foremen list is filtered out — we
    // only ever see the dedicated "self" chip for user 1234, never a
    // separate `foreman-1234` entry.
    expect(screen.queryByTestId("foreman-1234")).toBeNull();
  });

  it("does NOT render the foreman picker on a regular self-create flow", async () => {
    useLocalSearchParamsMock.mockReturnValue({ siteId: "11" });
    setupApiFetch();
    render(<NewTicketScreen />);
    // Wait for sites to load so the screen's loading state is past us.
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("foreman-picker")).toBeNull();
    // /api/field/me and /api/field/foremen are NOT fetched in non-
    // adjacent mode — proves the gate prevents wasted round-trips.
    const urls = apiFetchMock.mock.calls.map((c) => c[0]);
    expect(urls).not.toContain("/api/field/me");
    expect(urls).not.toContain("/api/field/foremen");
  });

  it("forwards the picked foremanUserId on the POST body when overridden", async () => {
    useLocalSearchParamsMock.mockReturnValue({ siteId: "11", adjacent: "1" });
    setupApiFetch();
    render(<NewTicketScreen />);
    // Wait for picker + work types to render before interacting.
    await screen.findByTestId("foreman-picker");
    const workTypeChip = await screen.findByTestId("work-type-7");
    tap(workTypeChip);
    // Override foreman to "Bob" (userId 5555).
    const bobChip = screen.getByTestId("foreman-5555");
    tap(bobChip);
    // Submit.
    const submit = screen.getByTestId("button-create-tickets");
    tap(submit);
    await waitFor(() => {
      const postCall = apiFetchMock.mock.calls.find(
        (c) => c[0] === "/api/field/tickets",
      );
      expect(postCall).toBeDefined();
    });
    const postCall = apiFetchMock.mock.calls.find(
      (c) => c[0] === "/api/field/tickets",
    )!;
    const body = JSON.parse((postCall[1] as { body: string }).body);
    expect(body.foremanUserId).toBe(5555);
    expect(body.adjacent).toBe(true);
    expect(body.siteLocationId).toBe(11);
    expect(body.workTypeId).toBe(7);
  });

  it("omits foremanUserId when the user accepts the default 'self' suggestion", async () => {
    useLocalSearchParamsMock.mockReturnValue({ siteId: "11", adjacent: "1" });
    setupApiFetch();
    render(<NewTicketScreen />);
    await screen.findByTestId("foreman-picker");
    const workTypeChip = await screen.findByTestId("work-type-7");
    tap(workTypeChip);
    // Don't touch the foreman picker — accept the suggested default.
    const submit = screen.getByTestId("button-create-tickets");
    tap(submit);
    await waitFor(() => {
      const postCall = apiFetchMock.mock.calls.find(
        (c) => c[0] === "/api/field/tickets",
      );
      expect(postCall).toBeDefined();
    });
    const postCall = apiFetchMock.mock.calls.find(
      (c) => c[0] === "/api/field/tickets",
    )!;
    const body = JSON.parse((postCall[1] as { body: string }).body);
    // foremanUserId is intentionally omitted so the server applies its
    // "foreman = self" default — proves the picker doesn't leak the
    // selected userId on the wire when the operator hasn't changed it.
    expect("foremanUserId" in body).toBe(false);
    expect(body.adjacent).toBe(true);
  });
});
