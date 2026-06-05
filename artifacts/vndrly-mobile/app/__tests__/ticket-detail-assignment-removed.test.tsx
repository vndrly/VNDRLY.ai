import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #572: when the office removes a vendor's site or work-type
// assignment after a field employee has already opened a ticket, the
// next state-change POST (en-route / check-in / check-out / submit)
// returns a structured `{ error: "site_vendor_mismatch" }` or
// `{ error: "work_type_not_allowed" }` 400. The mobile ticket detail
// screen must NOT pin that as an inline error under the failed button —
// it must surface the friendly "contact dispatch / cancel ticket"
// banner and force every state-change button into its disabled grey
// variant so the operator can't keep retrying a doomed action.

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
    muted: "#e5e5e5",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const { routerReplaceMock, routerPushMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  routerPushMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: {
    replace: routerReplaceMock,
    push: routerPushMock,
    back: vi.fn(),
  },
  // Task #669: ticket detail screen now sets a `headerRight` refresh
  // button via `<Stack.Screen options={...} />`. The test environment
  // renders nothing for it (returns `null`) — we just need the export
  // to exist so the JSX evaluates without throwing.
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "777" }),
  // Task #615: the ticket detail screen calls `useFocusEffect` to
  // schedule its banner-driven background polling. Tests don't navigate
  // between screens, so we treat the screen as always focused and run
  // the effect (and its cleanup) using the same React hook contract.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

// Identity translator so we can assert against the raw key the screen used.
// The same `t` reference must be returned on every call so dependency
// arrays that include `t` (e.g. `load`'s) don't fire on every render and
// trigger an infinite loop in the test environment.
const tIdentity = (k: string) => k;
const useTranslationReturn = { t: tIdentity };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
}));

// Task #613 added a foreground push listener for `ticket_unblocked`
// notifications. These tests don't need to fire pushes — they only need
// the import to resolve without dragging in the real Expo runtime
// (which fails in jsdom because it tries to require `./setupFastRefresh`).
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: () => {} }),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const ReactLib = (await import("react")).default;
  return {
    ...actual,
    Modal: ({
      visible,
      children,
    }: {
      visible?: boolean;
      children?: React.ReactNode;
    }) =>
      visible
        ? ReactLib.createElement(
            "div",
            { "data-testid": "rn-modal-visible" },
            children,
          )
        : null,
  };
});

vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  getForegroundPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { latitude: 30, longitude: -90 },
  })),
  watchPositionAsync: vi.fn(async () => ({ remove: () => {} })),
}));

vi.mock("expo-image", async () => {
  const ReactLib = (await import("react")).default;
  return { Image: (p: any) => ReactLib.createElement("img", { ...p }) };
});

vi.mock("expo-linear-gradient", async () => {
  const ReactLib = (await import("react")).default;
  return {
    LinearGradient: (p: any) => ReactLib.createElement("div", p, p.children),
  };
});

vi.mock("@/lib/auth", () => ({
  getUser: vi.fn(async () => ({
    id: 99,
    role: "field_employee",
    vendorId: 11,
    name: "Field Tester",
  })),
}));

vi.mock("@/lib/maps", () => ({
  MAP_TILE_SIZE: 256,
  getOsmTile: () => "",
  openInMaps: vi.fn(),
}));

vi.mock("@/lib/photos", () => ({
  captureAndUploadImage: vi.fn(async () => null),
}));

vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketRouteMap: () => ReactLib.createElement("div") };
});
vi.mock("@/components/TicketTrackingTimeline", async () => {
  const ReactLib = (await import("react")).default;
  return { TicketTrackingTimeline: () => ReactLib.createElement("div") };
});
vi.mock("@/components/CrewTimeSection", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});
vi.mock("@/components/CommentsPanel", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});
vi.mock("@/components/TicketStatusStepper", async () => {
  const ReactLib = (await import("react")).default;
  return { default: () => ReactLib.createElement("div") };
});

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

// AmberButton / BlueButton / GreyButton render as plain DOM buttons so we
// can assert disabled / press semantics without loading the asset-backed
// implementations. Crucially we PRESERVE the `testID` so the screen's
// existing `button-check-in` / `button-check-out` / `button-en-route` /
// `button-close-for-review` testIDs still resolve regardless of which
// variant (amber / blue / grey) the screen renders.
function makeButtonMock(label: string) {
  return async () => {
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
            "data-variant": label,
            "aria-disabled": isDisabled || undefined,
            disabled: isDisabled,
            onClick: isDisabled ? undefined : onPress,
          },
          typeof children === "string" ? children : "btn",
        );
      },
    };
  };
}

vi.mock("@/components/AmberButton", makeButtonMock("amber"));
vi.mock("@/components/BlueButton", makeButtonMock("blue"));
vi.mock("@/components/GreyButton", makeButtonMock("grey"));

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import TicketDetailScreen from "../ticket/[id]";
import { tap, tapThroughMileagePrompt } from "@/lib/testDomHelpers";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // mockReset (not clearAllMocks) wipes the mock implementation so impls
  // set in one test don't leak into the next.
  apiFetchMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
});

const TICKET_ID = 777;

// A field-employee ticket that's already checked in (status=in_progress
// with a check-in timestamp) so En Route / Check-Out / Submit are all
// candidate actions. We can then trigger an assignment-removed error on
// any of them to verify the banner handling.
const TICKET = {
  id: TICKET_ID,
  status: "in_progress",
  description: "Repair fence",
  siteName: "Acme Site",
  siteLocationId: 50,
  state: "TX",
  workTypeName: "Maintenance",
  vendorId: 11,
  lifecycleState: "on_site",
  arrivedAt: new Date().toISOString(),
  checkInTime: new Date().toISOString(),
};

function makeApiError(code: string, status = 400): Error {
  const err = new Error(code) as Error & {
    status?: number;
    data?: unknown;
  };
  err.status = status;
  err.data = { error: code, message: "Assignment removed by office." };
  return err;
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

// Default GET responses cover the load() Promise.all and the optional
// site/tax-rate follow-ups. Tests then layer the failing POST on top.
function mockHappyLoad() {
  apiFetchMock.mockImplementation(
    (url: string, opts?: { method?: string }) => {
      if (opts?.method && opts.method !== "GET") {
        return Promise.reject(new Error(`unexpected ${opts.method} ${url}`));
      }
      if (url === `/api/tickets/${TICKET_ID}`) return Promise.resolve(TICKET);
      if (url === `/api/tickets/${TICKET_ID}/line-items`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`) return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`) return Promise.resolve([]);
      if (url === `/api/site-locations/50`) {
        return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
      }
      if (url.startsWith("/api/tax-rates/")) {
        return Promise.resolve({ state: "TX", rate: "0" });
      }
      if (url === `/api/tickets/${TICKET_ID}/crew-sessions`) return Promise.resolve([]);
      return Promise.resolve(null);
    },
  );
}

describe("TicketDetailScreen — Task #572 assignment-removed banner", () => {
  it("shows the friendly banner (and not an inline error) when check-out POST returns site_vendor_mismatch", async () => {
    mockHappyLoad();
    const baseImpl = apiFetchMock.getMockImplementation()!;
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === `/api/tickets/${TICKET_ID}/check-out` && opts?.method === "POST") {
        return Promise.reject(makeApiError("site_vendor_mismatch"));
      }
      return baseImpl(url, opts);
    });

    render(<TicketDetailScreen />);

    // Wait for initial load to render the action group.
    await waitFor(() => {
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    // Banner is not yet showing.
    expect(screen.queryAllByTestId("banner-assignment-removed").length).toBe(0);

    // Check-out is initially the amber (live) variant.
    expect(firstByTestId("button-check-out").getAttribute("data-variant")).toBe("amber");

    // Tap check-out — POST rejects with the assignment code.
    await tapThroughMileagePrompt("button-check-out");

    // Banner appears with the SITE-mismatch copy and the cancel button.
    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });
    expect(
      screen.getAllByText("tickets.assignmentRemovedTitleSite").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("tickets.assignmentRemovedBodySite").length,
    ).toBeGreaterThan(0);
    expect(firstByTestId("text-assignment-removed-contact-hint")).toBeTruthy();
    expect(firstByTestId("button-cancel-from-assignment-banner")).toBeTruthy();

    // No inline error gets pinned under the failed button — the banner
    // is the single source of truth for this failure mode.
    expect(screen.queryAllByTestId("inline-error-check_out").length).toBe(0);

    // The state-change buttons that always render (check-in / check-out /
    // close-for-review) collapse to their disabled grey variant so the
    // operator can't keep retrying a doomed action. (En Route uses a
    // visibility gate based on the ticket's lifecycle state and isn't
    // present at all on an "on_site" ticket — it has its own dedicated
    // test below.)
    const checkIn = firstByTestId("button-check-in") as HTMLButtonElement;
    const checkOut = firstByTestId("button-check-out") as HTMLButtonElement;
    const close = firstByTestId("button-close-for-review") as HTMLButtonElement;
    expect(checkIn.getAttribute("data-variant")).toBe("grey");
    expect(checkOut.getAttribute("data-variant")).toBe("grey");
    expect(close.getAttribute("data-variant")).toBe("grey");
    expect(checkIn.disabled).toBe(true);
    expect(checkOut.disabled).toBe(true);
    expect(close.disabled).toBe(true);
  });

  it("shows the work-type variant of the banner when POST returns work_type_not_allowed", async () => {
    mockHappyLoad();
    const baseImpl = apiFetchMock.getMockImplementation()!;
    apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === `/api/tickets/${TICKET_ID}/check-out` && opts?.method === "POST") {
        return Promise.reject(makeApiError("work_type_not_allowed"));
      }
      return baseImpl(url, opts);
    });

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(firstByTestId("button-check-out")).toBeTruthy();
    });

    await tapThroughMileagePrompt("button-check-out");

    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });
    // Work-type copy, not site copy.
    expect(
      screen.getAllByText("tickets.assignmentRemovedTitleWorkType").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("tickets.assignmentRemovedBodyWorkType").length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("tickets.assignmentRemovedTitleSite").length).toBe(0);
  });

  // Task #615: while the banner is up, the screen polls /api/tickets/:id
  // every 7s and clears the banner the moment a poll succeeds — without
  // popping an Alert if the poll fails. We use fake timers around just
  // setInterval/clearInterval so React's testing scheduler keeps using
  // real microtasks.
  it("polls the ticket while the banner is up, clears it on a successful poll, and does not Alert on transient poll errors", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // Patch the Alert singleton in place so we can confirm background
    // polls don't surface user-facing modal alerts (the screen captured
    // its `Alert` reference via `import { Alert } from "react-native"`,
    // so we mutate the shared singleton rather than re-spying the
    // namespace import).
    const RN = await import("react-native");
    const originalAlert = RN.Alert.alert;
    const alertFn = vi.fn();
    RN.Alert.alert = alertFn;
    try {
      mockHappyLoad();
      const baseImpl = apiFetchMock.getMockImplementation()!;
      apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
        if (url === `/api/tickets/${TICKET_ID}/check-out` && opts?.method === "POST") {
          return Promise.reject(makeApiError("site_vendor_mismatch"));
        }
        return baseImpl(url, opts);
      });

      render(<TicketDetailScreen />);

      // Wait for initial load to settle and the action group to render.
      await waitFor(() => {
        expect(firstByTestId("button-check-out")).toBeTruthy();
      });

      // No interval ticks yet — the banner isn't up, so polling shouldn't
      // have started. Capture the GET-count baseline AFTER initial load.
      const countTicketGets = () =>
        apiFetchMock.mock.calls.filter(
          (c) =>
            c[0] === `/api/tickets/${TICKET_ID}` &&
            (!c[1] || (c[1] as { method?: string }).method === undefined ||
              (c[1] as { method?: string }).method === "GET"),
        ).length;
      const ticketGetsBeforeBanner = countTicketGets();
      expect(ticketGetsBeforeBanner).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(20_000);
      // Without a banner, no extra ticket GETs should have fired.
      expect(countTicketGets()).toBe(ticketGetsBeforeBanner);

      // Trigger the banner by failing a check-out POST.
      await tapThroughMileagePrompt("button-check-out");
      await waitFor(() => {
        expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
      });

      // Simulate a poll that itself fails. The screen MUST NOT surface an
      // Alert for this background-driven failure (otherwise users would
      // see a modal pop every 7s during a connectivity blip).
      apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!opts || !opts.method || opts.method === "GET")
        ) {
          return Promise.reject(new Error("transient network blip"));
        }
        return baseImpl(url, opts);
      });
      const alertCallsBefore = alertFn.mock.calls.length;
      const ticketGetsBeforeFailedPoll = countTicketGets();
      await vi.advanceTimersByTimeAsync(7_000);
      // Banner is still up after a failed poll, and no Alert was raised.
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
      expect(alertFn.mock.calls.length).toBe(alertCallsBefore);
      // The poll DID fire (we just suppressed the alert + kept the banner).
      expect(countTicketGets()).toBeGreaterThan(ticketGetsBeforeFailedPoll);

      // Now simulate the office re-granting the assignment: the next poll
      // returns 200, load() clears `assignmentRemoved`, and useFocusEffect
      // tears down the interval.
      apiFetchMock.mockImplementation(baseImpl);
      await vi.advanceTimersByTimeAsync(7_000);
      // Banner clears once a successful poll lands.
      await waitFor(() => {
        expect(screen.queryAllByTestId("banner-assignment-removed").length).toBe(0);
      });

      // Polling has stopped — advancing time further must not produce
      // additional ticket GETs.
      const ticketGetsAfterRecovery = countTicketGets();
      await vi.advanceTimersByTimeAsync(21_000);
      expect(countTicketGets()).toBe(ticketGetsAfterRecovery);
    } finally {
      RN.Alert.alert = originalAlert;
      vi.useRealTimers();
    }
  });

  // Task #621: while the assignment-removed banner is up, the 7s ticket
  // poll must pause when the OS sends the app to the background (lock
  // screen, app switcher, another app foregrounded) and resume when the
  // user returns to the app. The screen mirrors `AppState.currentState`
  // into a `appForegrounded` piece of state and the polling
  // useFocusEffect re-runs on every transition, tearing the interval
  // down when backgrounded and re-arming it when active again. This
  // test drives the same path by toggling `document.visibilityState`
  // and dispatching `visibilitychange` — react-native-web's `AppState`
  // already listens to that event and emits the matching 'change'
  // notification.
  it("pauses the assignment-removed poll while the app is backgrounded and resumes when it returns to the foreground", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    const setVisibility = async (state: "visible" | "hidden") => {
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    try {
      mockHappyLoad();
      const baseImpl = apiFetchMock.getMockImplementation()!;
      apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
        if (url === `/api/tickets/${TICKET_ID}/check-out` && opts?.method === "POST") {
          return Promise.reject(makeApiError("site_vendor_mismatch"));
        }
        return baseImpl(url, opts);
      });

      render(<TicketDetailScreen />);

      await waitFor(() => {
        expect(firstByTestId("button-check-out")).toBeTruthy();
      });

      // Bring the banner up so the polling effect arms.
      await tapThroughMileagePrompt("button-check-out");
      await waitFor(() => {
        expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
      });

      // From this point on we want the banner to stay up for the entire
      // test (a successful GET would clear `assignmentRemoved` and tear
      // down the polling effect, which is the OPPOSITE of what we are
      // measuring). So make every ticket GET reject as a transient blip
      // — the screen swallows poll errors without clearing the banner
      // (verified by Task #615's existing test).
      apiFetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
        if (
          url === `/api/tickets/${TICKET_ID}` &&
          (!opts || !opts.method || opts.method === "GET")
        ) {
          return Promise.reject(new Error("transient network blip"));
        }
        return baseImpl(url, opts);
      });

      const countTicketGets = () =>
        apiFetchMock.mock.calls.filter(
          (c) =>
            c[0] === `/api/tickets/${TICKET_ID}` &&
            (!c[1] || (c[1] as { method?: string }).method === undefined ||
              (c[1] as { method?: string }).method === "GET"),
        ).length;

      // Sanity check: while foregrounded, the next 7s tick fires a poll
      // (which the screen will swallow without clearing the banner).
      const foregroundBaseline = countTicketGets();
      await vi.advanceTimersByTimeAsync(7_000);
      expect(countTicketGets()).toBeGreaterThan(foregroundBaseline);
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();

      // Send the app to the background. The screen tears down the
      // interval, so subsequent ticks must NOT trigger ticket GETs.
      await setVisibility("hidden");

      const backgroundedBaseline = countTicketGets();
      await vi.advanceTimersByTimeAsync(21_000);
      expect(countTicketGets()).toBe(backgroundedBaseline);
      // Banner is still up — the user just doesn't see it because the
      // app is backgrounded; we never cleared `assignmentRemoved`.
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();

      // Bring the app back to the foreground. The screen re-arms the
      // interval and the next 7s tick must fire a fresh poll.
      await setVisibility("visible");

      const resumedBaseline = countTicketGets();
      await vi.advanceTimersByTimeAsync(7_000);
      expect(countTicketGets()).toBeGreaterThan(resumedBaseline);
    } finally {
      // Restore visibilityState so later tests / RN-web's singleton
      // emitter don't see a leaked "hidden" state.
      if (originalDescriptor) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          originalDescriptor,
        );
      }
      delete (document as unknown as { visibilityState?: unknown })
        .visibilityState;
      vi.useRealTimers();
    }
  });

  it("does not pin an inline error under the en-route button when its POST returns the assignment code", async () => {
    // Parallel coverage for the en-route variant of the same gate. The
    // mobile screen routes BOTH state-change codes from BOTH endpoints
    // through the same handleActionError → setAssignmentRemoved path,
    // so we want a regression test that catches anyone who later
    // accidentally adds an inline-error fallback to en-route.
    //
    // Seed the ticket in the pending_arrival lifecycle so the En Route
    // button renders as the live amber variant and is tappable.
    apiFetchMock.mockImplementation(
      (url: string, opts?: { method?: string }) => {
        if (url === `/api/tickets/${TICKET_ID}/en-route` && opts?.method === "POST") {
          return Promise.reject(makeApiError("site_vendor_mismatch"));
        }
        if (opts?.method && opts.method !== "GET") {
          return Promise.reject(new Error(`unexpected ${opts.method} ${url}`));
        }
        if (url === `/api/tickets/${TICKET_ID}`) {
          return Promise.resolve({
            ...TICKET,
            status: "initiated",
            lifecycleState: "pending_arrival",
            arrivedAt: null,
            checkInTime: null,
          });
        }
        if (url === `/api/tickets/${TICKET_ID}/line-items`) return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/note-logs`) return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/gps-logs`) return Promise.resolve([]);
        if (url === `/api/tickets/${TICKET_ID}/unlocks`) return Promise.resolve([]);
        if (url === `/api/site-locations/50`) {
          return Promise.resolve({ id: 50, latitude: 30, longitude: -90 });
        }
        if (url.startsWith("/api/tax-rates/")) {
          return Promise.resolve({ state: "TX", rate: "0" });
        }
        return Promise.resolve(null);
      },
    );

    render(<TicketDetailScreen />);

    await waitFor(() => {
      expect(firstByTestId("button-en-route")).toBeTruthy();
    });

    await tapThroughMileagePrompt("button-en-route");

    await waitFor(() => {
      expect(firstByTestId("banner-assignment-removed")).toBeTruthy();
    });
    // Specifically: NO inline-error-en_route element shows up. The whole
    // point of Task #572's banner is to replace per-button inline errors
    // for this failure mode.
    expect(screen.queryAllByTestId("inline-error-en_route").length).toBe(0);
  });
});
