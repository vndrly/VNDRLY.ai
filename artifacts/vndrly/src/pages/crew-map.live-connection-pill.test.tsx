import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #671 — pin down the Live / Reconnecting / Refreshed pill the
// crew-map page renders against the live crew-locations SSE channel
// (Task #666). Unlike the hotlist + comments panels (which use the
// shared `useLiveConnectionStatus` hook), the crew map drives its
// pill with hand-rolled state inside its existing
// `/api/live-locations/events` lifecycle so it can co-exist with the
// page's gap-banner refetch logic. We mirror the FakeEventSource
// pattern from tickets.live-connection-pill.test.tsx so a regression
// in either the open/error transitions or the location.hello refresh
// flash fails loudly here instead of silently in production.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim shape as the tickets list spec.
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
  dispatch(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const ev = {
      data: typeof data === "string" ? data : JSON.stringify(data),
    } as MessageEvent;
    for (const fn of set) fn(ev);
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

// react-leaflet pulls Leaflet in via DOM globals that aren't great in
// jsdom, and we don't render the map for this pill spec. Stub the
// surface used by crew-map.tsx so the page mounts cleanly.
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

// Leaflet itself is only used to build divIcons; stub the bits the
// page references so module init doesn't blow up.
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
  // The page reads the site-locations list to populate its filter
  // dropdown. Empty data is enough to mount the header (which is
  // where the pill lives) without spinning up a real query client.
  useListSiteLocations: () => ({ data: [] }),
  getListSiteLocationsQueryKey: () => ["site-locations"],
}));

vi.mock("@/components/map/map-compliance-issues-card", () => ({
  MapComplianceIssuesCard: () => null,
}));

import { render, act, screen } from "@testing-library/react";
import CrewMapPage from "./crew-map";

function findLiveLocationsEventSource(): FakeEventSource {
  // The locations URL carries query-string filters
  // (?vendorId=…&siteLocationId=…), so match on the path prefix.
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/live-locations\/events(\?|$)/.test(i.url),
  );
  if (!es) {
    throw new Error(
      `No EventSource for /api/live-locations/events. Saw: ${FakeEventSource.instances.map((i) => i.url).join(", ")}`,
    );
  }
  return es;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // The page's initial mount calls fetch() for /api/live-locations.
  // Stub it to a successful empty payload so the mount path doesn't
  // surface the offline error state (which would distract from the
  // pill assertions).
  (globalThis as { fetch: unknown }).fetch = vi.fn(async () =>
    new Response(JSON.stringify({ locations: [] }), { status: 200 }),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Visible labels are sourced from the i18n bundle (lib/locales/en.json
// > liveConnection). We assert them literally — the pill is the user-
// visible signal of feed health, so a copy regression matters as
// much as a state-machine regression.
const LABEL = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  refreshed: "Reconnected — refreshed",
} as const;

describe("crew-map page — live connection pill (Task #671)", () => {
  it("renders the pill in Connecting state on mount with a polite live region and the visible label", () => {
    render(<CrewMapPage />);
    const pill = screen.getByTestId("crew-map-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("connecting");
    // role=status + aria-live=polite is what makes the pill
    // screen-reader friendly without preempting focus.
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");
    // The visible label is what the user (and screen readers) actually
    // see/hear — assert it lives inside the live-region pill so the
    // announcement on each state change has real text behind it.
    const label = screen.getByTestId("crew-map-live-connection-pill-label");
    expect(label.textContent).toBe(LABEL.connecting);
    expect(pill.contains(label)).toBe(true);
  });

  it("flips to Live once the live-locations EventSource opens (visible label updates inside the live region)", () => {
    render(<CrewMapPage />);
    const es = findLiveLocationsEventSource();

    act(() => {
      es.fireOpen();
    });

    const pill = screen.getByTestId("crew-map-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("live");
    // Same live region instance, new announced text. Verifying both
    // the visible text AND that it sits under the aria-live=polite
    // pill is what guarantees the announcement actually fires.
    expect(pill.getAttribute("aria-live")).toBe("polite");
    expect(pill.textContent).toContain(LABEL.live);
    expect(
      screen.getByTestId("crew-map-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);
  });

  it("flips to Reconnecting on EventSource error after a healthy open (announced text changes)", () => {
    render(<CrewMapPage />);
    const es = findLiveLocationsEventSource();

    // Open first so we surface the drop after a healthy connection
    // — the more realistic ordering than erroring on first connect.
    act(() => {
      es.fireOpen();
    });
    expect(
      screen.getByTestId("crew-map-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);

    act(() => {
      es.fireError();
    });

    const pill = screen.getByTestId("crew-map-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("reconnecting");
    expect(pill.textContent).toContain(LABEL.reconnecting);
    expect(
      screen.getByTestId("crew-map-live-connection-pill-label").textContent,
    ).toBe(LABEL.reconnecting);
  });

  it("flashes Refreshed after a gap-flagged location.hello, then returns to Live (visible label cycles)", () => {
    render(<CrewMapPage />);
    const es = findLiveLocationsEventSource();

    // Drop, reconnect, then receive a hello with gap=true — the
    // realistic sequence the user sees after waking a laptop.
    act(() => {
      es.fireError();
    });
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.dispatch("location.hello", {
        type: "location.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });

    const pill = screen.getByTestId("crew-map-live-connection-pill");
    // The hello must beat the onopen we just fired — the page's
    // onopen handler intentionally guards against clobbering the
    // refreshed flash so the dispatcher actually sees the
    // confirmation that pins re-fetched.
    expect(pill.getAttribute("data-status")).toBe("refreshed");
    expect(pill.textContent).toContain(LABEL.refreshed);
    expect(
      screen.getByTestId("crew-map-live-connection-pill-label").textContent,
    ).toBe(LABEL.refreshed);

    // After the 3s hold the pill returns to "live" so it doesn't
    // sit on the success copy forever — and the announced text
    // follows.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(pill.getAttribute("data-status")).toBe("live");
    expect(
      screen.getByTestId("crew-map-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);
  });
});
