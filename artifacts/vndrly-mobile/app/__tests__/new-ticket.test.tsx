import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #535: verify that when POST /api/field/tickets responds with the
// structured `site_not_found` code, the screen re-fetches /api/field/sites,
// clears the now-invalid `siteId` (so the picker visually deselects), and
// surfaces the friendly "site no longer available" banner. The other
// inline-code paths (`site_vendor_mismatch`, `work_type_not_allowed`)
// are intentionally not exercised here — they're covered by the
// translateApiError unit tests.

// === Module mocks (must be hoisted before importing the screen) ===

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

const { routerReplaceMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: { replace: routerReplaceMock, push: vi.fn(), back: vi.fn() },
  useLocalSearchParams: () => ({}),
}));

// useTranslation: identity `t` so we can assert against translation keys.
// IMPORTANT: the same `t` reference is returned on every call so the
// screen's useEffect dependency array (which includes `t`) doesn't
// fire on every render — that would be an infinite loop in the test.
const tIdentity = (k: string) => k;
const useTranslationReturn = { t: tIdentity };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
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

// AmberButton renders as a plain DOM button so we can assert disabled / press
// semantics without loading the asset-backed implementation.
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
  // The screen calls Location.requestForegroundPermissionsAsync() on submit;
  // returning "denied" keeps lat/lng null without affecting the validation
  // path we want to test (the server still gets called with a body).
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
});

const SITES_BEFORE = [
  {
    id: 11,
    name: "Acme Old Site",
    address: "111 Old St",
    state: "TX",
    siteCode: "ACME-OLD",
    partnerName: "Acme Partner",
  },
  {
    id: 22,
    name: "Acme Other Site",
    address: "222 Other St",
    state: "TX",
    siteCode: "ACME-OTHER",
    partnerName: "Acme Partner",
  },
];

const SITES_AFTER = [
  // Old site #11 is gone — that's the deleted/unassigned scenario.
  {
    id: 22,
    name: "Acme Other Site",
    address: "222 Other St",
    state: "TX",
    siteCode: "ACME-OTHER",
    partnerName: "Acme Partner",
  },
  {
    id: 33,
    name: "Acme New Site",
    address: "333 New St",
    state: "TX",
    siteCode: "ACME-NEW",
    partnerName: "Acme Partner",
  },
];

const WORK_TYPES = [{ id: 7, name: "Maintenance", category: null }];

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function makeApiError(code: string, status = 400): Error {
  const err = new Error("Site not found.") as Error & {
    status?: number;
    data?: unknown;
  };
  err.status = status;
  err.data = { error: code, message: "Site not found." };
  return err;
}

describe("NewTicketScreen — site_not_found handling (Task #535)", () => {
  it("refreshes sites, clears the selection, and shows the friendly banner when POST returns site_not_found", async () => {
    // Sequence of apiFetch calls the screen makes during this scenario:
    //   1. GET /api/field/sites             -> SITES_BEFORE   (initial load)
    //   2. GET /api/field/sites/11/work-types -> WORK_TYPES   (after picking site 11)
    //   3. POST /api/field/tickets          -> rejects with site_not_found
    //   4. GET /api/field/sites             -> SITES_AFTER    (Task #535 refresh)
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/field/sites") {
        // First call returns the stale list, second call returns the fresh one.
        if (apiFetchMock.mock.calls.filter((c) => c[0] === "/api/field/sites").length === 1) {
          return Promise.resolve(SITES_BEFORE);
        }
        return Promise.resolve(SITES_AFTER);
      }
      if (url === "/api/field/sites/11/work-types") {
        return Promise.resolve(WORK_TYPES);
      }
      if (url === "/api/field/tickets" && opts?.method === "POST") {
        return Promise.reject(makeApiError("site_not_found"));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(<NewTicketScreen />);

    // Wait for initial sites load to finish (the loading spinner clears
    // once the GET resolves and the chips get rendered).
    await waitFor(() => {
      expect(screen.getAllByText("Acme Old Site").length).toBeGreaterThan(0);
    });

    // Pick the now-stale site and a work type.
    tap(screen.getAllByText("Acme Old Site")[0]);
    await waitFor(() => {
      expect(firstByTestId("work-type-7")).toBeTruthy();
    });
    tap(firstByTestId("work-type-7"));

    // No banner is showing yet.
    expect(screen.queryAllByTestId("site-unavailable-banner").length).toBe(0);

    // Submit. The POST will reject with site_not_found.
    tap(firstByTestId("button-create-tickets"));

    // The screen should:
    //   - re-fetch /api/field/sites (so the new list of sites appears)
    //   - render the friendly banner
    //   - drop the now-invalid Acme Old Site chip from the list entirely
    await waitFor(() => {
      expect(firstByTestId("site-unavailable-banner")).toBeTruthy();
    });
    expect(
      apiFetchMock.mock.calls.filter((c) => c[0] === "/api/field/sites").length,
    ).toBe(2);
    expect(screen.queryAllByText("Acme Old Site").length).toBe(0);
    expect(screen.getAllByText("Acme New Site").length).toBeGreaterThan(0);

    // The banner uses the new translation key (identity-translator returns it).
    expect(
      screen.getAllByText("tickets.newJob.siteUnavailableRefreshed").length,
    ).toBeGreaterThan(0);

    // The work-type chips section has collapsed because siteId was cleared,
    // and the create button is disabled (no site + no work type).
    expect(screen.queryAllByTestId("work-type-7").length).toBe(0);
    const createBtn = firstByTestId("button-create-tickets");
    expect(
      createBtn.getAttribute("aria-disabled") === "true" ||
        (createBtn as HTMLButtonElement).disabled === true,
    ).toBe(true);
  });

  it("dismisses the banner once the operator picks a site from the refreshed list", async () => {
    // Same flow as above, then tap one of the refreshed sites and assert
    // the banner clears.
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/field/sites") {
        if (apiFetchMock.mock.calls.filter((c) => c[0] === "/api/field/sites").length === 1) {
          return Promise.resolve(SITES_BEFORE);
        }
        return Promise.resolve(SITES_AFTER);
      }
      if (url.startsWith("/api/field/sites/") && url.endsWith("/work-types")) {
        return Promise.resolve(WORK_TYPES);
      }
      if (url === "/api/field/tickets" && opts?.method === "POST") {
        return Promise.reject(makeApiError("site_not_found"));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(<NewTicketScreen />);

    await waitFor(() => {
      expect(screen.getAllByText("Acme Old Site").length).toBeGreaterThan(0);
    });
    tap(screen.getAllByText("Acme Old Site")[0]);
    await waitFor(() => {
      expect(firstByTestId("work-type-7")).toBeTruthy();
    });
    tap(firstByTestId("work-type-7"));
    tap(firstByTestId("button-create-tickets"));

    await waitFor(() => {
      expect(firstByTestId("site-unavailable-banner")).toBeTruthy();
    });

    // Pick a site from the refreshed list.
    tap(screen.getAllByText("Acme New Site")[0]);

    await waitFor(() => {
      expect(screen.queryAllByTestId("site-unavailable-banner").length).toBe(0);
    });
  });
});

// Task #560: parallel coverage for the work-type recovery path. When
// POST /api/field/tickets responds with `work_type_not_allowed`, the
// screen should re-fetch /api/field/sites/:siteId/work-types, drop any
// selected work types that are no longer in the refreshed list, and
// surface the friendly "work type no longer approved" banner above the
// chips. The legacy inline `errors.work_type_not_allowed` text is
// replaced by this banner for this case.
const WORK_TYPES_BEFORE = [
  { id: 7, name: "Maintenance", category: null },
  { id: 8, name: "Inspection", category: null },
];

const WORK_TYPES_AFTER = [
  // Maintenance (#7) is gone — that's the removed-from-site scenario.
  { id: 8, name: "Inspection", category: null },
  { id: 9, name: "Repair", category: null },
];

describe("NewTicketScreen — work_type_not_allowed handling (Task #560)", () => {
  it("refreshes work types, prunes the disallowed selection, and shows the friendly banner when POST returns work_type_not_allowed", async () => {
    // Sequence of apiFetch calls:
    //   1. GET /api/field/sites                  -> SITES_BEFORE
    //   2. GET /api/field/sites/11/work-types    -> WORK_TYPES_BEFORE
    //   3. POST /api/field/tickets               -> rejects with work_type_not_allowed
    //   4. GET /api/field/sites/11/work-types    -> WORK_TYPES_AFTER (the refresh)
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/field/sites") {
        return Promise.resolve(SITES_BEFORE);
      }
      if (url === "/api/field/sites/11/work-types") {
        const calls = apiFetchMock.mock.calls.filter(
          (c) => c[0] === "/api/field/sites/11/work-types",
        ).length;
        // First call = before, second call = after the failed submit.
        return Promise.resolve(calls === 1 ? WORK_TYPES_BEFORE : WORK_TYPES_AFTER);
      }
      if (url === "/api/field/tickets" && opts?.method === "POST") {
        return Promise.reject(makeApiError("work_type_not_allowed"));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(<NewTicketScreen />);

    await waitFor(() => {
      expect(screen.getAllByText("Acme Old Site").length).toBeGreaterThan(0);
    });
    tap(screen.getAllByText("Acme Old Site")[0]);

    // Both starting work types should appear.
    await waitFor(() => {
      expect(firstByTestId("work-type-7")).toBeTruthy();
      expect(firstByTestId("work-type-8")).toBeTruthy();
    });

    // Select both. #7 is the one the office has secretly removed.
    tap(firstByTestId("work-type-7"));
    tap(firstByTestId("work-type-8"));

    // No banner yet.
    expect(screen.queryAllByTestId("work-type-unavailable-banner").length).toBe(
      0,
    );

    // Submit. POST will reject with work_type_not_allowed.
    tap(firstByTestId("button-create-tickets"));

    // After the failed submit:
    //   - the work-types endpoint should have been called twice (initial
    //     load + recovery refresh)
    //   - the friendly banner should be visible
    //   - the disallowed chip (#7) should be gone from the list
    //   - the still-allowed chip (#8) should remain — and remain selected
    //   - the new chip (#9) should appear
    await waitFor(() => {
      expect(firstByTestId("work-type-unavailable-banner")).toBeTruthy();
    });
    expect(
      apiFetchMock.mock.calls.filter(
        (c) => c[0] === "/api/field/sites/11/work-types",
      ).length,
    ).toBe(2);
    expect(screen.queryAllByTestId("work-type-7").length).toBe(0);
    expect(firstByTestId("work-type-8")).toBeTruthy();
    expect(firstByTestId("work-type-9")).toBeTruthy();

    // The banner copy uses the new translation key (identity translator).
    expect(
      screen.getAllByText("tickets.newJob.workTypeUnavailableRefreshed").length,
    ).toBeGreaterThan(0);

    // Inline error should NOT be present — the banner replaces it.
    expect(screen.queryAllByTestId("work-type-field-error").length).toBe(0);

    // Site picker should be untouched (still on Acme Old Site).
    expect(screen.queryAllByText("Acme Old Site").length).toBeGreaterThan(0);

    // Selection #8 was still allowed, so the create button should remain
    // enabled — the operator can re-submit immediately with what's left.
    const createBtn = firstByTestId("button-create-tickets");
    expect(
      createBtn.getAttribute("aria-disabled") === "true" ||
        (createBtn as HTMLButtonElement).disabled === true,
    ).toBe(false);
  });

  it("dismisses the work-type banner once the operator picks a chip from the refreshed list", async () => {
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/field/sites") {
        return Promise.resolve(SITES_BEFORE);
      }
      if (url === "/api/field/sites/11/work-types") {
        const calls = apiFetchMock.mock.calls.filter(
          (c) => c[0] === "/api/field/sites/11/work-types",
        ).length;
        return Promise.resolve(calls === 1 ? WORK_TYPES_BEFORE : WORK_TYPES_AFTER);
      }
      if (url === "/api/field/tickets" && opts?.method === "POST") {
        return Promise.reject(makeApiError("work_type_not_allowed"));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(<NewTicketScreen />);
    await waitFor(() => {
      expect(screen.getAllByText("Acme Old Site").length).toBeGreaterThan(0);
    });
    tap(screen.getAllByText("Acme Old Site")[0]);
    await waitFor(() => {
      expect(firstByTestId("work-type-7")).toBeTruthy();
    });
    tap(firstByTestId("work-type-7"));
    tap(firstByTestId("button-create-tickets"));

    await waitFor(() => {
      expect(firstByTestId("work-type-unavailable-banner")).toBeTruthy();
    });

    // Pick a chip from the refreshed list — the banner should clear.
    tap(firstByTestId("work-type-9"));

    await waitFor(() => {
      expect(
        screen.queryAllByTestId("work-type-unavailable-banner").length,
      ).toBe(0);
    });
  });
});
