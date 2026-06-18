import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    primaryForeground: "#fff",
    mutedForeground: "#666",
    muted: "#e5e5e5",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

const routerPushMock = vi.fn();
vi.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => routerPushMock(...a), back: vi.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require("react");
    ReactLib.useEffect(() => {
      const cleanupFn = cb();
      return typeof cleanupFn === "function" ? cleanupFn : undefined;
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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: lookup }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
}));

vi.mock("@/lib/notificationBadge", () => ({
  syncAppIconBadge: vi.fn(),
}));
vi.mock("@/lib/notificationSounds", () => ({
  stopBellTolling: vi.fn(),
}));

vi.mock("@/components/NotificationActionModal", () => ({
  default: ({
    visible,
    item,
    onClose,
  }: {
    visible: boolean;
    item: { id: number } | null;
    onClose: () => void;
  }) => {
    const ReactLib = require("react");
    if (!visible || !item) return null;
    return ReactLib.createElement(
      "div",
      { "data-testid": "notification-action-modal" },
      ReactLib.createElement(
        "span",
        { "data-testid": "notification-action-selected-id" },
        item.id,
      ),
      ReactLib.createElement("button", {
        "data-testid": "notification-action-close",
        onClick: onClose,
      }),
    );
  },
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>("react-native");
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
        onClick: onRefresh,
      }),
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      refreshControl,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => React.ReactNode;
      keyExtractor: (item: unknown) => string;
      refreshControl?: React.ReactNode;
    }) => {
      const items = data ?? [];
      return ReactLib.createElement(
        "div",
        { "data-testid": "flat-list" },
        refreshControl,
        items.map((it) =>
          ReactLib.createElement(
            ReactLib.Fragment,
            { key: keyExtractor(it) },
            renderItem({ item: it }),
          ),
        ),
      );
    },
  };
});

import NotificationsScreen from "../notifications";

describe("NotificationsScreen action modal", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    routerPushMock.mockReset();
    apiFetchMock.mockResolvedValue([
      {
        id: 42,
        type: "ticket_note_added",
        category: "tickets",
        title: "New note on a tracking number",
        body: "A new note was added on tracking #10950.",
        link: "/tickets/10950",
        isRead: false,
        createdAt: new Date().toISOString(),
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens action modal instead of navigating directly on row tap", async () => {
    render(<NotificationsScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("notification-42")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("notification-42"));
    });

    expect(screen.getByTestId("notification-action-modal")).toBeTruthy();
    expect(screen.getByTestId("notification-action-selected-id").textContent).toBe("42");
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
