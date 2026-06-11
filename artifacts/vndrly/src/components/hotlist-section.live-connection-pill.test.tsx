import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Task #671 — pin down the Live / Reconnecting / Refreshed pill the
// hotlist section now renders for each of partner / vendor / admin
// roles. All three variants ride along on the existing
// `/api/tickets/events` SSE stream via the shared
// `useLiveConnectionStatus` hook (Task #666). We mirror the
// FakeEventSource pattern from
// tickets.live-connection-pill.test.tsx so a regression in any
// role's wiring fails loudly here instead of silently in production.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. Same shim as the tickets list spec.
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

// Each test variant swaps the active user via `currentUserRef`. Doing
// it with a ref (rather than re-mocking per case) keeps the module
// graph stable so wouter / react-i18next / etc. cache cleanly.
type AuthUser = {
  userId: number;
  role: "partner" | "vendor" | "admin";
  displayName: string;
  partnerId: number | null;
  vendorId: number | null;
  vendorRole: null | "office";
  preferredLanguage: "en";
  activeMembershipId: number;
  availableMemberships: Array<{
    id: number;
    role: string;
    entityType: string;
    entityId: number;
    entityName: string;
  }>;
  requiresContextChoice: boolean;
};

const partnerUser: AuthUser = {
  userId: 1,
  role: "partner",
  displayName: "Partner Op",
  partnerId: 21,
  vendorId: null,
  vendorRole: null,
  preferredLanguage: "en",
  activeMembershipId: 1,
  availableMemberships: [
    { id: 1, role: "admin", entityType: "partner", entityId: 21, entityName: "BigCo" },
  ],
  requiresContextChoice: false,
};
const vendorUser: AuthUser = {
  userId: 2,
  role: "vendor",
  displayName: "Vendor Op",
  partnerId: null,
  vendorId: 11,
  vendorRole: "office",
  preferredLanguage: "en",
  activeMembershipId: 2,
  availableMemberships: [
    { id: 2, role: "admin", entityType: "vendor", entityId: 11, entityName: "Acme" },
  ],
  requiresContextChoice: false,
};
const adminUser: AuthUser = {
  userId: 3,
  role: "admin",
  displayName: "Admin",
  partnerId: null,
  vendorId: null,
  vendorRole: null,
  preferredLanguage: "en",
  activeMembershipId: 3,
  availableMemberships: [
    { id: 3, role: "admin", entityType: "admin", entityId: 0, entityName: "VNDRLY" },
  ],
  requiresContextChoice: false,
};

const currentUserRef: { current: AuthUser } = { current: partnerUser };

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: currentUserRef.current,
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
  // useLiveConnectionStatus effect (and the role views' invalidate-
  // on-gap callbacks that close over it) don't churn on every render.
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
    // The pill behavior under test is driven entirely by the SSE
    // handlers, not by the hotlist query results. Stubbing useQuery
    // / useMutation keeps the test surface tight to the pill logic
    // (and avoids spinning up a real QueryClient just to render the
    // header that wraps the pill).
    useQuery: () => ({ data: undefined, isLoading: true }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock("@workspace/api-client-react", () => ({
  // AdminHotlist calls useListPartners() to populate the partner
  // picker in the post-job dialog. Returning undefined keeps the
  // dialog inert and matches the loading state.
  useListPartners: () => ({ data: undefined }),
}));

import { render, act, screen } from "@testing-library/react";
import HotlistSection from "./hotlist-section";

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

// Each role renders its own role-scoped pill but they all use the
// same shared hook against the same SSE channel, so the test matrix
// pairs each role's pill testid with the queryKey its
// hello-with-gap callback should invalidate.
const roleCases: Array<{
  label: string;
  user: AuthUser;
  pillTestId: string;
  expectedInvalidateKey: ReadonlyArray<unknown>;
}> = [
  {
    label: "partner",
    user: partnerUser,
    pillTestId: "hotlist-partner-live-connection-pill",
    expectedInvalidateKey: ["hotlist", "list", "partner", 21],
  },
  {
    label: "vendor",
    user: vendorUser,
    pillTestId: "hotlist-vendor-live-connection-pill",
    expectedInvalidateKey: ["hotlist", "list", "vendor", 11],
  },
  {
    label: "admin",
    user: adminUser,
    pillTestId: "hotlist-admin-live-connection-pill",
    expectedInvalidateKey: ["hotlist", "list", "admin"],
  },
];

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

describe.each(roleCases)(
  "hotlist section ($label) — live connection pill (Task #671)",
  ({ user, pillTestId, expectedInvalidateKey }) => {
    beforeEach(() => {
      currentUserRef.current = user;
    });

    it("renders the pill in Connecting state on mount with a polite live region and the visible label", () => {
      render(<HotlistSection />);
      const pill = screen.getByTestId(pillTestId);
      expect(pill.getAttribute("data-status")).toBe("connecting");
      expect(pill.getAttribute("role")).toBe("status");
      expect(pill.getAttribute("aria-live")).toBe("polite");
      // The visible label is what the user (and screen readers)
      // actually see/hear — assert it lives inside the live-region
      // pill so the announcement on each state change has real text
      // behind it.
      const label = screen.getByTestId(`${pillTestId}-label`);
      expect(label.textContent).toBe(LABEL.connecting);
      expect(pill.contains(label)).toBe(true);
    });

    it("flips to Live once the EventSource opens (visible label updates inside the live region)", () => {
      render(<HotlistSection />);
      const es = findTicketsEventSource();

      act(() => {
        es.fireOpen();
      });

      const pill = screen.getByTestId(pillTestId);
      expect(pill.getAttribute("data-status")).toBe("live");
      // Same live region instance, new announced text. Verifying both
      // the visible text AND that it sits under the aria-live=polite
      // pill is what guarantees the announcement actually fires.
      expect(pill.getAttribute("aria-live")).toBe("polite");
      expect(pill.textContent).toContain(LABEL.live);
      expect(screen.getByTestId(`${pillTestId}-label`).textContent).toBe(
        LABEL.live,
      );
    });

    it("flips to Reconnecting on EventSource error after a healthy open (announced text changes)", () => {
      render(<HotlistSection />);
      const es = findTicketsEventSource();

      act(() => {
        es.fireOpen();
      });
      expect(screen.getByTestId(`${pillTestId}-label`).textContent).toBe(
        LABEL.live,
      );

      act(() => {
        es.fireError();
      });

      const pill = screen.getByTestId(pillTestId);
      expect(pill.getAttribute("data-status")).toBe("reconnecting");
      expect(pill.textContent).toContain(LABEL.reconnecting);
      expect(screen.getByTestId(`${pillTestId}-label`).textContent).toBe(
        LABEL.reconnecting,
      );
    });

    it("flashes Refreshed and re-fetches on a gap-flagged hello, then returns to Live (visible label cycles)", () => {
      render(<HotlistSection />);
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

      const pill = screen.getByTestId(pillTestId);
      // The hello must beat the onopen we just fired — the hook
      // intentionally guards against onopen clobbering the refreshed
      // flash so the user actually sees the confirmation.
      expect(pill.getAttribute("data-status")).toBe("refreshed");
      expect(pill.textContent).toContain(LABEL.refreshed);
      expect(screen.getByTestId(`${pillTestId}-label`).textContent).toBe(
        LABEL.refreshed,
      );
      // The role-scoped invalidate callback the section installs
      // must have fired so any awarded/converted/expired transitions
      // that landed while we were offline catch up immediately.
      expect(invalidateMock).toHaveBeenCalledWith({
        queryKey: expectedInvalidateKey,
      });

      // After the 3s hold the pill returns to "live" — and the
      // announced text follows.
      act(() => {
        vi.advanceTimersByTime(3001);
      });
      expect(pill.getAttribute("data-status")).toBe("live");
      expect(screen.getByTestId(`${pillTestId}-label`).textContent).toBe(
        LABEL.live,
      );
    });
  },
);
