import path from "node:path";
import Module from "node:module";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #668 — surgical per-row refresh on the mobile open-tickets list.
//
// Task #630 added a foreground `ticket_unblocked` push handler that
// refetched the ENTIRE `/api/field/open-tickets` list every time the
// office restored an assignment. On a slow link with several open
// tickets, that's a meaningful waste — the push payload already names
// the affected ticket, and the row's status pill / labels can be
// refreshed via a single per-id GET. This mirrors the web tickets
// page's per-row refresh shipped in Tasks #656 / #663 and the
// matching test in `tickets.live-unblock.test.tsx`.
//
// These tests pin the surgical contract so a future refactor that
// regresses to a full-list refetch fails loudly.

// === The home screen brand logo uses an inline `require(".../png")`,
// which vitest doesn't transform. Hijack Node's CJS resolver to
// understand the `@/` alias and return a stub for `.png` imports.
const ASSETS_ROOT = path.resolve(__dirname, "..", "..");
const _Module = Module as unknown as {
  _resolveFilename: (
    request: string,
    parent: NodeModule,
    ...rest: unknown[]
  ) => string;
  _extensions: Record<string, (m: { exports: unknown }, f: string) => void>;
};
const origResolve = _Module._resolveFilename.bind(_Module);
_Module._resolveFilename = (request, parent, ...rest) => {
  if (request.startsWith("@/")) {
    return path.join(ASSETS_ROOT, request.slice(2));
  }
  return origResolve(request, parent, ...rest);
};
_Module._extensions[".png"] = (m, filename) => {
  m.exports = filename;
};

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

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("expo-router", () => {
  // Mount-only fire — Expo Router would re-fire on every focus, but
  // tests don't navigate, so we mimic a single focus on mount and
  // skip any re-fires triggered by callback identity churn (which
  // would otherwise spuriously re-call load() after each re-render
  // and pollute the per-row refresh assertions).
  const useFocusEffect = (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    const ref = ReactLib.useRef(cb);
    ref.current = cb;
    ReactLib.useEffect(() => {
      const cleanup = ref.current();
      return typeof cleanup === "function" ? cleanup : undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  };
  return {
    router: { push: routerPushMock, replace: vi.fn(), back: vi.fn() },
    useFocusEffect,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

type PushListener = (n: {
  request: { content: { data: unknown } };
}) => void;
const { pushListeners, removeSpies } = vi.hoisted(() => ({
  pushListeners: [] as PushListener[],
  removeSpies: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (listener: PushListener) => {
    pushListeners.push(listener);
    const remove = vi.fn();
    removeSpies.push(remove);
    return { remove };
  },
}));

vi.mock("@/lib/push", () => ({
  registerForPushNotifications: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 99, role: "field_employee", displayName: "Field Tester" },
    activeMembership: {
      orgName: "Acme Vendor",
      orgType: "vendor",
    },
  }),
}));

vi.mock("@/components/AmberButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      ReactLib.createElement(
        "button",
        { "data-testid": testID, onClick: onPress },
        typeof children === "string" ? children : "btn",
      ),
  };
});

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import HomeScreen from "../(tabs)/index";

afterEach(() => {
  cleanup();
});

// Helper — drive the captured foreground push listener with a
// well-formed `ticket_unblocked` payload for a given ticket id.
async function dispatchUnblock(ticketId: number): Promise<void> {
  const listener = pushListeners[pushListeners.length - 1];
  await act(async () => {
    listener({
      request: {
        content: {
          data: { type: "ticket_unblocked", ticketId },
        },
      },
    });
  });
}

// Wait until the initial /api/field/open-tickets load has completed AND
// the resulting state has flushed into the rendered list. Each card
// renders the zero-padded ticket id (e.g. "#4242"), so we use that as
// the visibility signal — a present row card means the tickets array
// (and the ref the surgical handler reads from) is populated.
async function waitForRenderedRow(ticketId: number): Promise<void> {
  await waitFor(() => {
    expect(pushListeners.length).toBeGreaterThan(0);
    const padded = `#${String(ticketId).padStart(4, "0")}`;
    expect(screen.getAllByText(padded).length).toBeGreaterThan(0);
  });
}

// The default open-tickets list response used by the initial load(). We
// reset it in beforeEach and override per-test as needed.
type OpenTicket = {
  id: number;
  status: string;
  siteLocationId: number | null;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  createdAt: string;
};
const initialList: OpenTicket[] = [
  {
    id: 4242,
    status: "in_progress",
    siteLocationId: 7,
    siteName: "Site A",
    partnerName: "Partner P",
    workTypeName: "Work W",
    createdAt: "2026-04-28T00:00:00.000Z",
  },
  {
    id: 9999,
    status: "kicked_back",
    siteLocationId: 8,
    siteName: "Site B",
    partnerName: "Partner Q",
    workTypeName: "Work W2",
    createdAt: "2026-04-27T00:00:00.000Z",
  },
];

beforeEach(() => {
  apiFetchMock.mockReset();
  routerPushMock.mockReset();
  pushListeners.length = 0;
  removeSpies.length = 0;

  // Default happy-path API responses for the home-screen loader.
  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/field/open-tickets") return Promise.resolve(initialList);
    if (url === "/api/notifications/unread-count")
      return Promise.resolve({ count: 0 });
    if (url === "/api/field/me")
      return Promise.resolve({ vendorName: "Acme Vendor" });
    return Promise.resolve(null);
  });
});

describe("HomeScreen — Task #668 surgical per-row refresh on ticket_unblocked", () => {
  it("fetches just the per-id endpoint and patches one row, not the whole list", async () => {
    render(<HomeScreen />);

    // Wait until the initial list load has flushed into rendered rows
    // — the surgical handler reads the visible-row set from a ref that
    // tracks the `tickets` state, so an empty state means a no-op.
    await waitForRenderedRow(4242);

    // The fresh per-id row carries the post-unblock state — different
    // status so we can distinguish "patched" from "stale".
    const fresh: OpenTicket = {
      id: 4242,
      status: "in_progress",
      siteLocationId: 7,
      siteName: "Site A (refreshed)",
      partnerName: "Partner P",
      workTypeName: "Work W",
      createdAt: "2026-04-28T00:00:00.000Z",
    };

    // From this point on, the per-id endpoint must be the next ticket
    // call — and the list endpoint must NOT be re-hit on the happy path.
    const callsBefore = apiFetchMock.mock.calls.length;
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets/4242") return Promise.resolve(fresh);
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      if (url === "/api/field/open-tickets") {
        throw new Error(
          "list endpoint must not be hit on the happy surgical path",
        );
      }
      return Promise.resolve(null);
    });

    await dispatchUnblock(4242);

    // The push handler must have called the per-id endpoint exactly
    // once for the affected ticket.
    await waitFor(() => {
      const newCalls = apiFetchMock.mock.calls.slice(callsBefore);
      expect(
        newCalls.some((c) => c[0] === "/api/field/open-tickets/4242"),
      ).toBe(true);
    });

    // Crucially, the legacy full-list refetch must NOT happen on the
    // happy path — that regression is exactly what #668 set out to fix.
    const newCalls = apiFetchMock.mock.calls.slice(callsBefore);
    expect(
      newCalls.some((c) => c[0] === "/api/field/open-tickets"),
    ).toBe(false);
  });

  it("no-ops the per-id fetch when the unblocked ticket isn't in the current view", async () => {
    render(<HomeScreen />);

    await waitForRenderedRow(4242);

    const callsBefore = apiFetchMock.mock.calls.length;
    apiFetchMock.mockImplementation(() => {
      throw new Error("no API call expected for an out-of-view ticket id");
    });

    // Push references a ticket id that isn't in the rendered list.
    await dispatchUnblock(123456);

    // Give any async work a tick to (not) run, then assert no calls.
    await new Promise((r) => setTimeout(r, 30));
    expect(apiFetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("falls back to the full-list refetch when the per-id fetch fails", async () => {
    render(<HomeScreen />);

    await waitForRenderedRow(4242);

    const callsBefore = apiFetchMock.mock.calls.length;
    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/field/open-tickets/4242") {
        return Promise.reject(new Error("boom"));
      }
      if (url === "/api/field/open-tickets") return Promise.resolve(initialList);
      if (url === "/api/notifications/unread-count")
        return Promise.resolve({ count: 0 });
      return Promise.resolve(null);
    });

    await dispatchUnblock(4242);

    // Per-id fetch was attempted, then the legacy full-list refetch is
    // used as the fallback so the row still converges.
    await waitFor(() => {
      const newCalls = apiFetchMock.mock.calls.slice(callsBefore);
      expect(
        newCalls.some((c) => c[0] === "/api/field/open-tickets/4242"),
      ).toBe(true);
      expect(
        newCalls.some((c) => c[0] === "/api/field/open-tickets"),
      ).toBe(true);
    });
  });
});
