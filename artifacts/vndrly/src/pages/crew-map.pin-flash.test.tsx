import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #153 — when a crew member's ticket transitions lifecycle stages
// the live SSE handler flashes the corresponding row in the side panel
// (existing behaviour) AND must now visibly pulse the marker pin on the
// map itself. The pulse is rendered as an extra ring element inside the
// car-pin's divIcon HTML, gated on a `flashing` prop. We can't render
// real Leaflet in jsdom, so this spec mocks `leaflet.divIcon` to capture
// the HTML the page actually hands to Leaflet for each marker — that is
// the exact surface the user sees in production.

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

// react-leaflet renders the Marker as a div whose `data-icon-html` we
// can inspect. The real component just hands the icon to Leaflet; for
// this spec we just need to surface what HTML each pin actually carries.
type StubIcon = { __html?: string };
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "stub-map" }, children),
  Marker: ({
    icon,
    children,
  }: {
    icon?: StubIcon;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "stub-marker",
        "data-icon-html": icon?.__html ?? "",
      },
      children,
    ),
  Polyline: () => null,
  Popup: () => null,
  TileLayer: () => null,
  useMap: () => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  }),
}));

// Capture the html argument so the test can assert on what Leaflet
// would actually render. Mirror the shape react-leaflet expects so the
// stub Marker can read it back.
vi.mock("leaflet", () => ({
  default: {
    divIcon: (opts: { html: string }) => ({ __html: opts.html }),
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

vi.mock("@/components/map/map-compliance-issues-card", () => ({
  MapComplianceIssuesCard: () => null,
}));

import { render, act, screen } from "@testing-library/react";
import CrewMapPage from "./crew-map";

const SEED_LOCATION = {
  employeeId: 42,
  employeeName: "Riley Field",
  ticketId: 7001,
  vendorId: 11,
  lifecycleState: "en_route",
  siteName: "Test Site",
  siteCode: "TS-1",
  siteLatitude: 30.27,
  siteLongitude: -97.74,
  latitude: 30.26,
  longitude: -97.73,
  batteryLevel: 0.8,
  heading: 90,
  speedMps: 12,
  recordedAt: new Date().toISOString(),
};

function findCarMarkerHtml(): string {
  const markers = screen.getAllByTestId("stub-marker");
  for (const m of markers) {
    const html = m.getAttribute("data-icon-html") ?? "";
    if (html.includes("crew-car-pin")) return html;
  }
  throw new Error(
    `No crew-car-pin marker found. Got: ${markers
      .map((m) => (m.getAttribute("data-icon-html") ?? "").slice(0, 60))
      .join(" | ")}`,
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // Seed the page with one en-route crew member so the SSE ping below
  // is a true lifecycle transition, not a first sighting.
  (globalThis as { fetch: unknown }).fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({ locations: [SEED_LOCATION] }),
      { status: 200 },
    ),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function findLiveLocationsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/live-locations\/events(\?|$)/.test(i.url),
  );
  if (!es) {
    throw new Error(
      `No live-locations EventSource. Saw: ${FakeEventSource.instances
        .map((i) => i.url)
        .join(", ")}`,
    );
  }
  return es;
}

describe("crew-map page — pin flash on lifecycle transition (Task #153)", () => {
  it("renders the car pin without the flash ring at rest", async () => {
    render(<CrewMapPage />);
    // Let the initial fetch resolve so the seeded location renders.
    await act(async () => {
      await Promise.resolve();
    });
    const html = findCarMarkerHtml();
    expect(html).not.toContain("lifecycle-flash-pin-ring");
    expect(html).toContain('data-flashing="0"');
  });

  it("adds the expanding ring overlay to the pin when an SSE ping flips lifecycle (en_route → on_site)", async () => {
    render(<CrewMapPage />);
    await act(async () => {
      await Promise.resolve();
    });
    const es = findLiveLocationsEventSource();
    act(() => {
      es.fireOpen();
    });

    // SSE ping for the same employee/ticket but a new lifecycle stage.
    // This is the demo-critical transition: dispatcher sees the pin
    // pulse the moment the field employee taps "Check In".
    act(() => {
      es.dispatch("location.ping", {
        type: "location.ping",
        location: {
          ...SEED_LOCATION,
          lifecycleState: "on_site",
          recordedAt: new Date(Date.now() + 1000).toISOString(),
        },
      });
    });

    const html = findCarMarkerHtml();
    expect(html).toContain('data-flashing="1"');
    expect(html).toContain("lifecycle-flash-pin-ring");
    // The ring is a sibling of the rotated SVG wrapper so the inline
    // `transform: translate(...)` on the outer container that anchors
    // the pin on the map is left intact — verify the anchor transform
    // is still present in the pin HTML (regression guard for the bug
    // where animating the outer div clobbered its translate).
    expect(html).toContain("transform:translate(-20px,-28px)");
  });

  it("removes the flash ring after the 2s flash window elapses", async () => {
    render(<CrewMapPage />);
    await act(async () => {
      await Promise.resolve();
    });
    const es = findLiveLocationsEventSource();
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.dispatch("location.ping", {
        type: "location.ping",
        location: {
          ...SEED_LOCATION,
          lifecycleState: "on_site",
          recordedAt: new Date(Date.now() + 1000).toISOString(),
        },
      });
    });
    expect(findCarMarkerHtml()).toContain("lifecycle-flash-pin-ring");

    // The page schedules a 2s timer to clear the flashing state. Once
    // it fires, the pin re-renders without the ring overlay.
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    const html = findCarMarkerHtml();
    expect(html).not.toContain("lifecycle-flash-pin-ring");
    expect(html).toContain('data-flashing="0"');
  });
});
