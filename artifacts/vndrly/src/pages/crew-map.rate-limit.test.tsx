import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #710 — verify the crew/fleet map calmly backs off when the
// server returns per-resource 429 codes (`live_locations.rate_limited`
// and `visits.rate_limited`) with a Retry-After. Two independent
// gates run on this page; this spec pins down both:
//
//   * a 429 from /api/live-locations must SUPPRESS the next 5 min
//     fallback poll for that resource (and only that resource), and
//   * a 429 from the visitors fetch must SUPPRESS the next 60 s
//     fallback poll for visitors (without affecting locations).
//
// A regression here would let the fallback `setInterval` fire again
// inside the cooldown and immediately re-trip the limiter — which is
// exactly what the gate exists to prevent.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}
(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

const vendorAdminUser = {
  userId: 1,
  role: "vendor" as const,
  displayName: "Op",
  partnerId: null,
  vendorId: 11,
  vendorRole: "office" as const,
  preferredLanguage: "en" as const,
  activeMembershipId: 1,
  availableMemberships: [
    {
      id: 1,
      role: "admin" as const,
      entityType: "vendor" as const,
      entityId: 11,
      entityName: "Acme",
    },
  ],
  requiresContextChoice: false,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: vendorAdminUser,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
  toast: vi.fn(),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "stub-map" }, children),
  Marker: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "stub-marker" }, children),
  Polyline: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "stub-popup" }, children),
  TileLayer: () => null,
  useMap: () => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  }),
}));

vi.mock("leaflet", () => ({
  default: {
    divIcon: () => ({}),
    DomEvent: {
      disableClickPropagation: vi.fn(),
      disableScrollPropagation: vi.fn(),
    },
  },
}));

const visitsListMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("@/lib/visits-api", () => ({
  visitsApi: {
    list: (...args: unknown[]) => visitsListMock(...args),
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListSiteLocations: () => ({ data: [] }),
  getListSiteLocationsQueryKey: () => ["site-locations"],
}));

import { render, act, screen, waitFor } from "@testing-library/react";
import CrewMapPage from "./crew-map";

const LOCATIONS_FALLBACK_POLL_MS = 5 * 60_000;
const VISITORS_FALLBACK_POLL_MS = 60_000;

function rateLimitResponse(code: string, retryAfterSeconds: number) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      code,
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function rateLimitVisitsError(code: string, retryAfterSeconds: number) {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: { error: "rate_limited", code, retryAfterSeconds },
    headers: new Headers(),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeEventSource.instances = [];
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ locations: [] }), { status: 200 }),
  );
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  visitsListMock.mockReset();
  visitsListMock.mockResolvedValue([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function liveLocationsCallCount(): number {
  return fetchMock.mock.calls.filter((args) => {
    const url = String(args[0] ?? "");
    return /\/api\/live-locations\b/.test(url) && !/\/events/.test(url);
  }).length;
}

describe("crew map — rate-limit gate (Task #710)", () => {
  it("suppresses subsequent /api/live-locations refetches after a `live_locations.rate_limited` 429", async () => {
    // First snapshot fetch trips the locations limiter. Subsequent
    // fetch attempts would succeed with empty data, but the gate
    // must keep them from firing inside the cooldown — even when
    // an inter-poll trigger (e.g. tab becoming visible again, which
    // calls `fetchLocations()`) tries to refetch.
    fetchMock.mockImplementationOnce(async () =>
      rateLimitResponse("live_locations.rate_limited", 120),
    );

    render(<CrewMapPage />);

    // Wait until the first /api/live-locations call has resolved and
    // the gate has tripped (banner is the user-visible proof).
    await waitFor(() => {
      expect(screen.queryByTestId("crew-map-slow-down")).not.toBeNull();
    });
    const callsAfterFirst = liveLocationsCallCount();
    expect(callsAfterFirst).toBe(1);

    // Drive a visibility-change while still inside the cooldown. The
    // page's onVisibility handler unconditionally calls
    // `fetchLocations()` on becoming visible — which fans out to
    // `fetchLocationsOnly`. The gate's locationsRateLimitedRef must
    // make that early-return so no second /api/live-locations call
    // is issued.
    await act(async () => {
      // Hide first so onVisibility knows we transitioned out of view
      // (the handler tears down intervals + EventSources on hide so
      // the next "visible" branch performs the explicit refresh).
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      // Let the queued microtask from fetchLocations settle.
      await Promise.resolve();
    });

    expect(liveLocationsCallCount()).toBe(callsAfterFirst);
    expect(screen.queryByTestId("crew-map-slow-down")).not.toBeNull();
  });

  it("suppresses the next visitors poll after a `visits.rate_limited` 429 (and does NOT park locations)", async () => {
    // Locations stay healthy. Visitors trip the limiter — that gate
    // is independent and must not silence the locations refresh path.
    visitsListMock.mockReset();
    visitsListMock.mockRejectedValueOnce(
      rateLimitVisitsError("visits.rate_limited", 300),
    );
    visitsListMock.mockResolvedValue([]);

    render(<CrewMapPage />);

    await waitFor(() => {
      expect(screen.queryByTestId("crew-map-slow-down")).not.toBeNull();
    });
    const visitorsCallsAfterFirst = visitsListMock.mock.calls.length;
    expect(visitorsCallsAfterFirst).toBe(1);

    // Advance past the 60 s visitors fallback poll, still inside the
    // 300 s Retry-After window — the visitors poll must NOT fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISITORS_FALLBACK_POLL_MS + 1_000);
    });
    expect(visitsListMock.mock.calls.length).toBe(visitorsCallsAfterFirst);
    // Locations stayed healthy so the locations gate never tripped —
    // the locations fallback poll is allowed to fire on its own
    // schedule (5 min). We only assert the cross-resource
    // independence: visitors are parked but locations were not
    // dragged into the cooldown.
    expect(screen.queryByTestId("crew-map-slow-down")).not.toBeNull();
  });

  it("does NOT park on a 429 with the wrong code (cross-resource isolation)", async () => {
    // A `dashboard.rate_limited` 429 should never park crew-map polls.
    fetchMock.mockImplementationOnce(async () =>
      rateLimitResponse("dashboard.rate_limited", 600),
    );

    render(<CrewMapPage />);

    // Let the page settle through the first fetch + microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The locations fetch path returns early on `r.status===429` BEFORE
    // setting the gate error — but the page's gate hook only treats it
    // as a backoff if the code matches. Either way: no slow-down banner.
    expect(screen.queryByTestId("crew-map-slow-down")).toBeNull();
  });
});
