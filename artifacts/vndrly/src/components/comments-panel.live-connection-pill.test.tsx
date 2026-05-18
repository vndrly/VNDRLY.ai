import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #671 — pin down the Live / Reconnecting / Refreshed pill the
// comments panel now renders for ticket-source comment threads. The
// pill rides along on the existing `/api/tickets/events` SSE stream
// via the shared `useLiveConnectionStatus` hook (Task #666). We
// mirror the FakeEventSource pattern from
// tickets.live-connection-pill.test.tsx so a regression in the
// hotlist/comments wiring fails loudly here instead of silently in
// production.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim shape as the tickets list spec
// — onopen/onerror setters plus an addEventListener fan-out so the
// test can drive the connection lifecycle that
// `useLiveConnectionStatus` listens for.
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

const { invalidateMock, queryClientStub } = vi.hoisted(() => {
  const m = vi.fn();
  // useQueryClient must hand back a stable reference so the
  // useLiveConnectionStatus effect (and the page's invalidate-on-gap
  // callback that closes over it) doesn't churn on every render.
  return { invalidateMock: m, queryClientStub: { invalidateQueries: m } };
});

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => queryClientStub,
    // The pill behavior under test is driven by the SSE handlers, not
    // by the comments query results. Stubbing these keeps the test
    // surface tight to the pill logic.
    useQuery: () => ({ data: [], isLoading: false }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

import { render, act, screen } from "@testing-library/react";
import { CommentsPanel } from "./comments-panel";

function findTicketsEventSource(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) =>
    /\/api\/tickets\/events$/.test(i.url),
  );
  if (!es) throw new Error("No EventSource for /api/tickets/events");
  return es;
}

beforeEach(() => {
  invalidateMock.mockReset();
  FakeEventSource.instances = [];
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

describe("comments panel — live connection pill (Task #671)", () => {
  it("starts in Connecting state on mount and exposes a polite live region with the visible label", () => {
    render(<CommentsPanel source="ticket" parentId={42} />);
    const pill = screen.getByTestId("comments-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("connecting");
    // role=status + aria-live=polite is what makes the pill
    // screen-reader friendly without preempting focus. Pin it down so
    // a future refactor doesn't accidentally drop it.
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");
    // The visible label is what the user (and screen readers) actually
    // see/hear — assert it lives inside the live-region pill so the
    // announcement on each state change has real text behind it.
    const label = screen.getByTestId("comments-live-connection-pill-label");
    expect(label.textContent).toBe(LABEL.connecting);
    expect(pill.contains(label)).toBe(true);
  });

  it("flips to Live once the EventSource opens (visible label updates inside the live region)", () => {
    render(<CommentsPanel source="ticket" parentId={42} />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });

    const pill = screen.getByTestId("comments-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("live");
    // Same live region instance, new announced text. Verifying both
    // the visible text AND that it sits under the aria-live=polite
    // pill is what guarantees the announcement actually fires.
    expect(pill.getAttribute("aria-live")).toBe("polite");
    expect(pill.textContent).toContain(LABEL.live);
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);
  });

  it("flips to Reconnecting on EventSource error after a healthy open (announced text changes)", () => {
    render(<CommentsPanel source="ticket" parentId={42} />);
    const es = findTicketsEventSource();

    act(() => {
      es.fireOpen();
    });
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);

    act(() => {
      es.fireError();
    });

    const pill = screen.getByTestId("comments-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("reconnecting");
    expect(pill.textContent).toContain(LABEL.reconnecting);
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe(LABEL.reconnecting);
  });

  it("flashes Refreshed after a gap-flagged hello and then returns to Live (visible label cycles)", () => {
    render(<CommentsPanel source="ticket" parentId={42} />);
    const es = findTicketsEventSource();

    // Drop, reconnect, then receive a hello with gap=true — the
    // realistic sequence the user sees after waking a laptop.
    act(() => {
      es.fireError();
    });
    act(() => {
      es.fireOpen();
    });
    act(() => {
      es.dispatch("ticket.hello", {
        type: "ticket.hello",
        currentSeq: 99,
        lastSeenSeq: 17,
        gap: true,
      });
    });

    const pill = screen.getByTestId("comments-live-connection-pill");
    // The hello must beat the onopen we just fired — the hook
    // intentionally guards against onopen clobbering the refreshed
    // flash so the user actually sees the confirmation. The gap must
    // also have triggered the refetch callback the panel installs to
    // catch up missed comments.
    expect(pill.getAttribute("data-status")).toBe("refreshed");
    expect(pill.textContent).toContain(LABEL.refreshed);
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe(LABEL.refreshed);
    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: ["comments", "ticket", 42],
    });

    // After the 3s hold the pill returns to "live" — and the
    // announced text follows.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(pill.getAttribute("data-status")).toBe("live");
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe(LABEL.live);
  });

  it("renders the pill AND opens the per-job hotlist comments EventSource (Task #676)", () => {
    // Task #676: hotlist comments now have their own SSE bus
    // (`/api/hotlist/jobs/:id/comments/events`), so the panel renders
    // the standard live pill instead of the old "Not live" + Refresh
    // affordance.
    render(<CommentsPanel source="hotlist" parentId={7} />);
    const pill = screen.getByTestId("comments-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("connecting");

    // Two EventSources are opened: one by `useLiveConnectionStatus` for
    // the pill, one by the panel itself for the per-event refetch hint.
    // Both must point at the per-job hotlist comments stream — never at
    // /api/tickets/events.
    const hotlistStreams = FakeEventSource.instances.filter((i) =>
      /\/api\/hotlist\/jobs\/7\/comments\/events$/.test(i.url),
    );
    expect(hotlistStreams.length).toBeGreaterThan(0);
    expect(
      FakeEventSource.instances.some((i) =>
        /\/api\/tickets\/events$/.test(i.url),
      ),
    ).toBe(false);
  });
});
