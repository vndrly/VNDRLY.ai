import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #116 — pin down the "wedged channel" recovery path on the
// crew-map page's live-locations EventSource. The browser auto-
// reconnects on transient drops, but a proxy 502 or laptop sleep can
// leave the socket in CLOSED with no further onopen callbacks ever
// firing. After ~10s of being errored we (a) surface a louder "Live
// updates paused — reconnecting…" indicator so dispatchers know the
// pins are stale, and (b) force-close + reopen the EventSource so a
// fresh connection attempt can succeed. Once it does, we re-fetch
// /api/live-locations once to catch up on pings that landed during
// the dead window.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

type FakeESListener = (ev: MessageEvent) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<FakeESListener>>();
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: FakeESListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: FakeESListener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.closed = true;
  }
  fireOpen(): void {
    this.onopen?.(new Event("open"));
  }
  fireError(): void {
    this.onerror?.(new Event("error"));
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
      role: "admin",
      entityType: "vendor",
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

vi.mock("@/lib/visits-api", () => ({
  visitsApi: {
    list: vi.fn(async () => [] as unknown[]),
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListSiteLocations: () => ({ data: [] }),
  getListSiteLocationsQueryKey: () => ["site-locations"],
}));

import { render, act, screen } from "@testing-library/react";
import CrewMapPage from "./crew-map";

function findLiveLocationsEventSources(): FakeEventSource[] {
  return FakeEventSource.instances.filter((i) =>
    /\/api\/live-locations\/events(\?|$)/.test(i.url),
  );
}

function liveLocationsFetchCount(fetchMock: ReturnType<typeof vi.fn>): number {
  let count = 0;
  for (const call of fetchMock.mock.calls) {
    const url = String(call[0]);
    // Only count snapshot fetches, not the SSE channel — but the SSE
    // channel goes through `EventSource`, not `fetch`, so any
    // /api/live-locations call here is the REST snapshot path.
    if (/\/api\/live-locations(\?|$)/.test(url)) count++;
  }
  return count;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeEventSource.instances = [];
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (/\/api\/live-locations(\?|$)/.test(url)) {
      return new Response(JSON.stringify({ locations: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("crew-map page — stuck SSE reconnect (Task #116)", () => {
  it("after a sustained SSE error, shows the louder 'Live updates paused' indicator, force-reopens, and re-fetches /api/live-locations once on the recovery open", async () => {
    render(<CrewMapPage />);

    // Initial mount creates exactly one EventSource for live
    // locations and fires one REST snapshot fetch.
    let sources = findLiveLocationsEventSources();
    expect(sources.length).toBe(1);
    const initialEs = sources[0];

    // Drain any microtasks queued from the initial mount fetch.
    await act(async () => {
      await Promise.resolve();
    });
    const initialFetchCount = liveLocationsFetchCount(fetchMock);
    expect(initialFetchCount).toBe(1);

    // Healthy open before the drop — mirrors the realistic
    // "everything was fine, then network broke" sequence.
    act(() => {
      initialEs.fireOpen();
    });
    expect(
      screen.getByTestId("crew-map-live-connection-pill").getAttribute(
        "data-status",
      ),
    ).toBe("live");
    // No "stuck" banner yet.
    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();

    // Network drops — the channel errors. The pill turns
    // "reconnecting" immediately, but the louder banner should NOT
    // appear yet (we only want it after a sustained dead window).
    act(() => {
      initialEs.fireError();
    });
    expect(
      screen.getByTestId("crew-map-live-connection-pill").getAttribute(
        "data-status",
      ),
    ).toBe("reconnecting");
    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();

    // Half the stuck window: still no louder banner.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();
    // And no extra REST fetches yet — backfill happens on the
    // recovery open, not on the timer itself.
    expect(liveLocationsFetchCount(fetchMock)).toBe(initialFetchCount);

    // Cross the 10s threshold — the louder banner appears, the
    // wedged EventSource is force-closed, and a fresh one is opened
    // by the page's reconnect kick.
    act(() => {
      vi.advanceTimersByTime(5_500);
    });
    const stuckBanner = screen.getByTestId("text-live-updates-paused");
    expect(stuckBanner.textContent).toContain("Live updates paused");
    expect(stuckBanner.getAttribute("aria-live")).toBe("polite");
    expect(initialEs.closed).toBe(true);
    sources = findLiveLocationsEventSources();
    // A new EventSource was constructed for the reopen attempt.
    expect(sources.length).toBe(2);
    const recoveryEs = sources[1];
    expect(recoveryEs.closed).toBe(false);

    // Drain queued microtasks the reopen scheduled.
    await act(async () => {
      await Promise.resolve();
    });
    // No backfill fetch fired YET — the recovery REST call only
    // runs once we know the new socket is healthy (onopen).
    expect(liveLocationsFetchCount(fetchMock)).toBe(initialFetchCount);

    // The recovery socket opens successfully — the louder banner
    // clears, the pill flashes "refreshed" (matching the gap-recovery
    // confirmation), and exactly one extra /api/live-locations
    // snapshot fetch fires to backfill any pings missed during the
    // dead window.
    act(() => {
      recoveryEs.fireOpen();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();
    expect(
      screen.getByTestId("crew-map-live-connection-pill").getAttribute(
        "data-status",
      ),
    ).toBe("refreshed");
    expect(liveLocationsFetchCount(fetchMock)).toBe(initialFetchCount + 1);

    // After the 3s "refreshed" hold, the pill returns to "live" so
    // it doesn't camp on the success copy forever.
    act(() => {
      vi.advanceTimersByTime(3_001);
    });
    expect(
      screen.getByTestId("crew-map-live-connection-pill").getAttribute(
        "data-status",
      ),
    ).toBe("live");
  });

  it("does not show the louder banner when the browser auto-reconnects before the 10s grace window", async () => {
    render(<CrewMapPage />);
    let sources = findLiveLocationsEventSources();
    const es = sources[0];

    act(() => {
      es.fireOpen();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const baselineFetchCount = liveLocationsFetchCount(fetchMock);

    // Brief drop — a few seconds shy of the threshold.
    act(() => {
      es.fireError();
    });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    // Browser auto-reconnect succeeds on the same EventSource (the
    // FakeEventSource doesn't auto-recover, but firing onopen here
    // simulates the realistic case where a healthy open arrives
    // before our 10s timer).
    act(() => {
      es.fireOpen();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The louder banner never appeared — only the pill briefly
    // flipped to "reconnecting" and back. No second EventSource was
    // ever constructed.
    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();
    sources = findLiveLocationsEventSources();
    expect(sources.length).toBe(1);

    // But because we *did* see an error before the recovery open,
    // we still backfilled the snapshot once — pings that landed
    // during even a short dead window get caught up.
    expect(liveLocationsFetchCount(fetchMock)).toBe(baselineFetchCount + 1);

    // After the 10s mark passes, no late-firing stuck timer triggers.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.queryByTestId("text-live-updates-paused")).toBeNull();
    sources = findLiveLocationsEventSources();
    expect(sources.length).toBe(1);
  });
});
