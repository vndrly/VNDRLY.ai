import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #639 — verify the Crew Changes screen pulls a filtered slice
// of /api/notifications (`crew_added` + `crew_removed` only),
// renders the rows it gets back, deep-links a tap on a `crew_added`
// row to the matching ticket, marks rows read on tap, and paginates
// via the `?before=` cursor when the user scrolls to the end.

// Task #186: render a recognizable stub for the active-org indicator
// so the regression test below can assert it shows up in the
// crew-changes screen's custom header. crew-changes is one of the
// rare screens registered with `headerShown: false` in the root
// stack, so the global root-stack `headerRight` that injects
// ActiveOrgIndicator never runs here — the screen has to render it
// itself. Using a stub avoids spinning up the AuthProvider.
vi.mock("@/components/ActiveOrgIndicator", () => {
  const ReactLib = require("react");
  return {
    default: () =>
      ReactLib.createElement("div", { "data-testid": "active-org-indicator" }),
  };
});

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

const { routerPushMock, routerBackMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  routerBackMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => routerPushMock(...a),
    back: (...a: unknown[]) => routerBackMock(...a),
  },
  // Real expo-router invokes the callback once on mount; the test
  // shim does the same so the screen's focus-driven refresh fires.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
    }, []);
  },
}));

import enLocale from "../../lib/locales/en.json";
function lookup(key: string): string {
  const parts = key.split(".");
  let cur: unknown = enLocale as unknown;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}
const tIdentity = (k: string, vars?: Record<string, unknown>) => {
  let out = lookup(k);
  if (vars && typeof vars === "object") {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), String(value));
    }
  }
  return out;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tIdentity }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "http://localhost",
}));

// Stub RefreshControl with a clickable shim so the test can fire
// pull-to-refresh, and stub FlatList so onEndReached can be triggered
// from a button press (the real virtualised list doesn't render
// in jsdom).
vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>(
    "react-native",
  );
  const ReactLib = (await import("react")).default;
  return {
    ...actual,
    RefreshControl: ({
      refreshing,
      onRefresh,
    }: {
      refreshing: boolean;
      onRefresh: () => void;
    }) =>
      ReactLib.createElement("button", {
        "data-testid": "refresh-control",
        "data-refreshing": refreshing ? "true" : "false",
        onClick: onRefresh,
      }),
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      ListEmptyComponent,
      ListFooterComponent,
      onEndReached,
      refreshControl,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => React.ReactNode;
      keyExtractor: (item: unknown) => string;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      onEndReached?: () => void;
      refreshControl?: React.ReactNode;
    }) => {
      const items = data ?? [];
      return ReactLib.createElement(
        "div",
        { "data-testid": "flat-list" },
        refreshControl,
        items.length === 0
          ? ListEmptyComponent
          : items.map((it) =>
              ReactLib.createElement(
                ReactLib.Fragment,
                { key: keyExtractor(it) },
                renderItem({ item: it }),
              ),
            ),
        onEndReached
          ? ReactLib.createElement("button", {
              "data-testid": "load-more-trigger",
              onClick: onEndReached,
            })
          : null,
        ListFooterComponent,
      );
    },
  };
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CrewChangesScreen from "../crew-changes";

beforeEach(() => {
  apiFetchMock.mockReset();
  routerPushMock.mockReset();
  routerBackMock.mockReset();
});

afterEach(() => {
  cleanup();
});

const ROW_ADDED = {
  id: 101,
  type: "crew_added",
  category: "crew",
  title: "You've been added to a ticket",
  body: "Tracking VNDRLY-00007777 — tap to see the job.",
  link: "/tickets/7777",
  isRead: false,
  createdAt: "2026-04-30T12:00:00.000Z",
};
const ROW_REMOVED = {
  id: 100,
  type: "crew_removed",
  category: "crew",
  title: "Removed from a ticket crew",
  body: "You've been taken off ticket VNDRLY-00007777 at Well Pad 12.",
  link: "/tickets",
  isRead: false,
  createdAt: "2026-04-29T08:00:00.000Z",
};

describe("CrewChangesScreen — Task #639", () => {
  it("requests only crew_added + crew_removed and renders the returned rows", async () => {
    apiFetchMock.mockResolvedValueOnce([ROW_ADDED, ROW_REMOVED]);
    render(<CrewChangesScreen />);

    await waitFor(() => {
      expect(screen.getByTestId(`crew-change-${ROW_ADDED.id}`)).toBeTruthy();
      expect(screen.getByTestId(`crew-change-${ROW_REMOVED.id}`)).toBeTruthy();
    });

    // The fetch URL must carry the type filter — without it, this
    // screen would silently widen into the full inbox payload.
    const firstUrl = apiFetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain("/api/notifications?");
    // The comma may be raw or percent-encoded depending on how the
    // URL was assembled — both decode to the same query value.
    expect(firstUrl).toMatch(/type=crew_added(?:%2C|,)crew_removed/);
    expect(firstUrl).toContain("limit=25");

    // Each known type renders its dedicated badge.
    expect(
      screen.getByTestId(`crew-change-${ROW_ADDED.id}-type-crew_added`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`crew-change-${ROW_REMOVED.id}-type-crew_removed`),
    ).toBeTruthy();
  });

  it("deep-links a crew_added row to the ticket detail and marks it read", async () => {
    apiFetchMock.mockResolvedValueOnce([ROW_ADDED]);
    apiFetchMock.mockResolvedValueOnce(null); // POST /read response
    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId(`crew-change-${ROW_ADDED.id}`)).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(`crew-change-${ROW_ADDED.id}`));
    });

    // Link is `/tickets/7777` so the row deep-links to the mobile
    // ticket detail at `/ticket/7777` (singular path on mobile).
    expect(routerPushMock).toHaveBeenCalledWith("/ticket/7777");
    // Mark-as-read POST issued to the right id.
    const readCall = apiFetchMock.mock.calls.find(
      ([u]) => typeof u === "string" && u === `/api/notifications/${ROW_ADDED.id}/read`,
    );
    expect(readCall).toBeTruthy();
    expect((readCall as unknown as [string, { method?: string }])[1]?.method).toBe(
      "POST",
    );
  });

  it("routes a crew_removed row to the open-tickets list (no detail access)", async () => {
    apiFetchMock.mockResolvedValueOnce([ROW_REMOVED]);
    apiFetchMock.mockResolvedValueOnce(null);
    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId(`crew-change-${ROW_REMOVED.id}`)).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(`crew-change-${ROW_REMOVED.id}`));
    });

    // The crew_removed link is `/tickets` (no id) on purpose — the
    // removed worker no longer has access to the ticket detail
    // (see crew.ts comment on the crew_removed notify call). We
    // still want the row to be navigable, so the press should land
    // on the open-tickets list (the tabs index), NOT on
    // /ticket/<id> which would 403.
    const detailCall = routerPushMock.mock.calls.find(([p]) =>
      typeof p === "string" && p.startsWith("/ticket/"),
    );
    expect(detailCall).toBeUndefined();
    const listCall = routerPushMock.mock.calls.find(
      ([p]) => p === "/(tabs)",
    );
    expect(listCall).toBeTruthy();

    // Mark-as-read still fires.
    const readCall = apiFetchMock.mock.calls.find(
      ([u]) => typeof u === "string" && u === `/api/notifications/${ROW_REMOVED.id}/read`,
    );
    expect(readCall).toBeTruthy();
  });

  it("paginates with ?before=<oldestCreatedAt> when the user reaches the end", async () => {
    // Page 1 returns exactly PAGE_SIZE (25) rows so `hasMore` stays
    // true. Use 25 distinct ids to keep the keyExtractor happy.
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      ...ROW_ADDED,
      id: 1000 + i,
      createdAt: `2026-04-30T${String(23 - Math.floor(i / 60))}:00:${String(59 - (i % 60)).padStart(2, "0")}.000Z`,
    }));
    const oldestCursor = page1[page1.length - 1].createdAt;
    const page2 = [{ ...ROW_REMOVED, id: 200 }];
    apiFetchMock.mockResolvedValueOnce(page1);
    apiFetchMock.mockResolvedValueOnce(page2);

    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId(`crew-change-${page1[0].id}`)).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("load-more-trigger"));
    });

    await waitFor(() => {
      expect(screen.getByTestId(`crew-change-200`)).toBeTruthy();
    });

    // The "load more" call MUST carry the cursor of the oldest row
    // we already have — otherwise we'd just refetch page 1 in a loop.
    const moreUrl = apiFetchMock.mock.calls[1][0] as string;
    expect(moreUrl).toMatch(/type=crew_added(?:%2C|,)crew_removed/);
    expect(moreUrl).toContain(`before=${encodeURIComponent(oldestCursor)}`);
  });

  it("shows the empty-state copy when there are no crew changes", async () => {
    apiFetchMock.mockResolvedValueOnce([]);
    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByText("No recent crew changes.")).toBeTruthy();
    });
  });

  it("shows the load-failed copy when the initial fetch errors", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("boom"));
    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load crew changes.")).toBeTruthy();
    });
  });

  // Task #186: this screen draws its own header (the route is
  // registered with `headerShown: false` in the root stack), so the
  // global root-stack `headerRight` that injects ActiveOrgIndicator
  // never runs here. The screen has to render the indicator itself
  // so dual-role users keep the active-org reminder when they push
  // into Crew Changes.
  it("renders ActiveOrgIndicator in the screen's custom header", async () => {
    apiFetchMock.mockResolvedValueOnce([]);
    render(<CrewChangesScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("active-org-indicator")).toBeTruthy();
    });
  });
});
