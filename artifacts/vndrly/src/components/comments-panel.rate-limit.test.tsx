import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #699 — verify the comments panel surfaces the existing
// "reconnecting" pill (matching the tickets reconnect pattern) when
// the comments query throws a 429 with code "comments.rate_limited".
// The visible pill IS the friendly slow-down indicator for this
// surface, so a regression here would silently leave users staring at
// a stale list with no signal that we've paused.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

// jsdom has no EventSource. We don't drive any SSE traffic in this
// spec — we only need the constructor to exist so the panel's
// `useLiveConnectionStatus` and per-resource SSE hooks mount cleanly.
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

// We control the comments query result so we can flip it to a 429
// error mid-test. The other queries (eligible-mentions, attachment
// presigning) remain stubbed via the default useMutation/useQuery
// shapes — they're not under test here.
const { commentsQueryState } = vi.hoisted(() => ({
  commentsQueryState: {
    current: { data: [] as unknown[], isLoading: false, error: null as unknown },
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: (opts: { queryKey?: unknown[] }) => {
      // The comments query's queryKey starts with "comments"; every
      // other useQuery (eligible mentions, etc.) gets a benign empty
      // result so the panel renders.
      const key = Array.isArray(opts?.queryKey) ? opts.queryKey[0] : null;
      if (key === "comments") {
        return commentsQueryState.current;
      }
      return { data: [], isLoading: false };
    },
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

import { render, screen } from "@testing-library/react";
import { CommentsPanel } from "./comments-panel";

beforeEach(() => {
  FakeEventSource.instances = [];
  commentsQueryState.current = {
    data: [],
    isLoading: false,
    error: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function rateLimitError(retryAfterSeconds: number) {
  // Mirrors the shape `jsonFetch` (and the panel's inline fetch) build
  // for non-2xx responses: status + data.code + data.retryAfterSeconds.
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      error: "rate_limited",
      code: "comments.rate_limited",
      retryAfterSeconds,
    },
    headers: new Headers(),
  });
}

describe("comments panel — rate-limit slow-down (Task #699)", () => {
  it("flips the live-connection pill to 'reconnecting' when the comments query 429s", () => {
    // Seed the mocked query with a 429 BEFORE the first render so the
    // panel mounts directly into the parked state. This mirrors the
    // realistic sequence where a returning user lands on a thread that
    // is already over its limit.
    commentsQueryState.current = {
      data: [],
      isLoading: false,
      error: rateLimitError(15),
    };

    render(<CommentsPanel source="ticket" parentId={42} />);

    const pill = screen.getByTestId("comments-live-connection-pill");
    // The gate must override whatever `useLiveConnectionStatus` would
    // otherwise show (typically "connecting" before the SSE opens).
    expect(pill.getAttribute("data-status")).toBe("reconnecting");
    // The visible label travels with the data-status — the pill is
    // the user-visible slow-down signal, so the label must change too.
    expect(
      screen.getByTestId("comments-live-connection-pill-label").textContent,
    ).toBe("Reconnecting…");
  });

  it("does not park on a non-429 query error (pill follows the live status, not the error)", () => {
    // A 500 from /api/.../comments should NOT trip the rate-limit gate
    // — otherwise generic outages would silently surface as a slow-
    // down pill instead of the existing toast/empty UX.
    commentsQueryState.current = {
      data: [],
      isLoading: false,
      error: Object.assign(new Error("server"), {
        status: 500,
        data: { error: "internal" },
        headers: new Headers(),
      }),
    };

    render(<CommentsPanel source="ticket" parentId={42} />);

    const pill = screen.getByTestId("comments-live-connection-pill");
    // `useLiveConnectionStatus` starts in "connecting" and we never
    // fire the SSE open here, so that's where it stays — crucially
    // NOT "reconnecting".
    expect(pill.getAttribute("data-status")).toBe("connecting");
  });

  it("ignores 429s whose code is not the comments limiter (e.g. notifications)", () => {
    // Cross-resource isolation: a 429 with the wrong code must not
    // park the comments thread. The notifications-coded 429 belongs
    // to the bell, which has its own gate.
    commentsQueryState.current = {
      data: [],
      isLoading: false,
      error: Object.assign(new Error("Too Many Requests"), {
        status: 429,
        data: {
          error: "rate_limited",
          code: "notifications.rate_limited",
          retryAfterSeconds: 30,
        },
        headers: new Headers(),
      }),
    };

    render(<CommentsPanel source="ticket" parentId={42} />);

    const pill = screen.getByTestId("comments-live-connection-pill");
    expect(pill.getAttribute("data-status")).toBe("connecting");
  });
});
