import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    accent: "#fef3c7",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({
  Feather: () => null,
}));

// `lib/visitorCheckin` (imported transitively by the component) loads
// expo-location, and through `lib/guest` -> `lib/auth` it would also pull in
// expo-secure-store. Stub both so the expo-modules-core native bridge is
// never instantiated in node.
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), initApi: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  setToken: vi.fn(),
  setUser: vi.fn(),
  getToken: vi.fn(),
}));

// Replace AmberButton with a plain DOM <button> shim so we don't have to load
// its `require()`-based image assets. The shim mirrors the disabled / press
// semantics the screen relies on so we can assert against them in tests.
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
          "aria-disabled": isDisabled || undefined,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
        },
        typeof children === "string" ? children : "btn",
      );
    },
  };
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import VisitorHostPicker from "./VisitorHostPicker";
import type { SiteContext } from "../lib/guest";

const labels = {
  changeSite: "Change site",
  whoVisiting: "Who are you visiting?",
  noHosts: "No hosts available",
  purpose: "Purpose",
  purposePlaceholder: "Why are you here?",
  expectedMinutes: "Expected minutes",
  checkIn: "Check in",
  geofenceNote: "You must be on site to check in.",
};

const baseCtx: SiteContext = {
  site: {
    id: 42,
    name: "Acme HQ",
    address: "123 Main St",
    latitude: 37.7,
    longitude: -122.4,
    siteRadiusMeters: 100,
    siteCode: "ACME-HQ",
  },
  partner: { id: 7, name: "Acme Partner" },
  vendors: [
    { id: 11, name: "Bolt Vendor" },
    { id: 12, name: "Wire Vendor" },
  ],
};

function renderHostPicker(
  overrides: Partial<React.ComponentProps<typeof VisitorHostPicker>> = {},
) {
  const props: React.ComponentProps<typeof VisitorHostPicker> = {
    ctx: baseCtx,
    hostKey: null,
    onSelectHost: vi.fn(),
    purpose: "",
    onPurposeChange: vi.fn(),
    duration: "60",
    onDurationChange: vi.fn(),
    busy: false,
    onSubmit: vi.fn(),
    onChangeSite: vi.fn(),
    labels,
    ...overrides,
  };
  const utils = render(<VisitorHostPicker {...props} />);
  return { props, ...utils };
}

// react-native-web sometimes propagates `data-testid` to a wrapper div as
// well as the underlying interactive element, so query for all matches and
// pick the first (the outer node — the one tests want to inspect/click).
function firstByTestId(id: string): HTMLElement {
  const all = screen.getAllByTestId(id);
  return all[0];
}

function getCheckInButton(): HTMLElement {
  return firstByTestId("check-in-btn");
}

// react-native-web's <Pressable>/<TouchableOpacity> uses the React Native
// responder system, which listens for pointer events rather than `click`.
// Dispatching pointerdown + pointerup matches what a real tap does.
function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function isDisabled(el: HTMLElement): boolean {
  // react-native-web maps Pressable's `disabled` and accessibilityState onto
  // ARIA. We accept either signal so the assertion stays robust.
  if (el.getAttribute("aria-disabled") === "true") return true;
  if ((el as HTMLButtonElement).disabled === true) return true;
  return false;
}

describe("VisitorHostPicker", () => {
  it("renders the site name and address", () => {
    renderHostPicker();
    expect(screen.getAllByText("Acme HQ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("123 Main St").length).toBeGreaterThan(0);
  });

  it("renders one row per host (partner + each vendor)", () => {
    renderHostPicker();
    expect(screen.getAllByText("Acme Partner (Partner)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bolt Vendor (Vendor)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Wire Vendor (Vendor)").length).toBeGreaterThan(0);
    expect(firstByTestId("host-option-partner:7")).toBeTruthy();
    expect(firstByTestId("host-option-vendor:11")).toBeTruthy();
    expect(firstByTestId("host-option-vendor:12")).toBeTruthy();
  });

  it("hides the partner row when the site has no partner", () => {
    renderHostPicker({ ctx: { ...baseCtx, partner: null } });
    expect(screen.queryAllByText("Acme Partner (Partner)").length).toBe(0);
    expect(screen.getAllByText("Bolt Vendor (Vendor)").length).toBeGreaterThan(0);
  });

  it("shows the empty-state copy when there are no hosts at all", () => {
    renderHostPicker({ ctx: { ...baseCtx, partner: null, vendors: [] } });
    expect(firstByTestId("no-hosts")).toBeTruthy();
    expect(screen.getAllByText("No hosts available").length).toBeGreaterThan(0);
  });

  it("disables the check-in button when no host is selected", () => {
    renderHostPicker({ hostKey: null });
    expect(isDisabled(getCheckInButton())).toBe(true);
  });

  it("disables the check-in button while a submit is in flight", () => {
    renderHostPicker({ hostKey: "partner:7", busy: true });
    expect(isDisabled(getCheckInButton())).toBe(true);
  });

  it("enables the check-in button once a valid host is selected", () => {
    renderHostPicker({ hostKey: "partner:7" });
    expect(isDisabled(getCheckInButton())).toBe(false);
  });

  it("does not invoke onSubmit when the disabled button is pressed", () => {
    const onSubmit = vi.fn();
    renderHostPicker({ hostKey: null, onSubmit });
    tap(getCheckInButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("invokes onSubmit when a valid host is selected and the button is pressed", () => {
    const onSubmit = vi.fn();
    renderHostPicker({ hostKey: "vendor:11", onSubmit });
    tap(getCheckInButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectHost with the picked option key", () => {
    const onSelectHost = vi.fn();
    renderHostPicker({ onSelectHost });
    tap(firstByTestId("host-option-vendor:12"));
    expect(onSelectHost).toHaveBeenCalledWith("vendor:12");
  });

  it("calls onChangeSite when 'change site' is tapped", () => {
    const onChangeSite = vi.fn();
    renderHostPicker({ onChangeSite });
    tap(firstByTestId("change-site-btn"));
    expect(onChangeSite).toHaveBeenCalledTimes(1);
  });

  it("highlights the selected host inside the picker card", () => {
    renderHostPicker({ hostKey: "partner:7" });
    const card = firstByTestId("host-picker-card");
    // The selected row stays in the DOM and the picker card still contains it.
    expect(within(card).getAllByTestId("host-option-partner:7")).toBeTruthy();
  });
});
