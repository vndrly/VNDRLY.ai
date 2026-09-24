import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { apiFetch, list, auth, params } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  list: { props: {} as any },
  auth: { generation: 0, listeners: new Set<() => void>() },
  params: { category: undefined as string | undefined },
}));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: auth.generation }),
  isAuthScopeCurrent: (scope: any) => scope.generation === auth.generation,
  subscribeUser: (cb: () => void) => {
    auth.listeners.add(cb);
    return () => auth.listeners.delete(cb);
  },
  subscribeToken: () => () => {},
}));
vi.mock("@/lib/notificationBadge", () => ({ syncAppIconBadge: vi.fn() }));
vi.mock("@/lib/notificationSounds", () => ({ stopBellTolling: vi.fn() }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "orange", card: "white", border: "gray" }),
}));
vi.mock("@/components/AdaptiveNavigationShell", () => ({
  REGULAR_NAVIGATION_BREAKPOINT: 768,
}));
vi.mock("react-native-svg", () => ({
  default: () => null,
  Defs: () => null,
  LinearGradient: () => null,
  Rect: () => null,
  Stop: () => null,
}));
vi.mock("@/components/PortalPageHeader", () => ({ default: () => null }));
vi.mock("@/components/InPageHeader", () => ({
  default: ({ right }: any) => <div>{right}</div>,
}));
vi.mock("@/components/NotificationActionModal", () => ({
  default: () => null,
}));
vi.mock("@/components/NotificationSendToModal", () => ({
  default: () => null,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, testID, accessibilityState }: any) => (
    <button
      data-testid={testID}
      aria-selected={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: () => null },
  usePathname: () => "/gate-notifications",
  useLocalSearchParams: () => params,
  useFocusEffect: () => {},
}));
function translate(key: string, options?: any) {
  return options?.defaultValue ?? key;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("react-native", async (original) => {
  const actual = await original<typeof import("react-native")>();
  return {
    ...actual,
    FlatList: (props: any) => {
      list.props = props;
      return (
        <div data-testid="notification-results">
          {props.refreshControl}
          {props.data.length
            ? props.data.map((item: any) => (
                <React.Fragment key={item.id}>
                  {props.renderItem({ item })}
                </React.Fragment>
              ))
            : props.ListEmptyComponent}
          {props.ListFooterComponent}
          <button data-testid="load-more" onClick={props.onEndReached} />
        </div>
      );
    },
    RefreshControl: ({ onRefresh }: any) => (
      <button data-testid="refresh" onClick={onRefresh} />
    ),
  };
});
import NotificationsScreen from "../notifications";
import { __resetRateLimitForTests } from "@/lib/rateLimitGate";
const categories = [
  "schedule",
  "gate_crew",
  "messages",
  "handoffs",
  "tasks",
  "compliance",
  "alerts",
];
const timestamp = "2026-09-24T12:00:00.000975Z";
const row = (id: number, displayCategory = "tasks") => ({
  id,
  type: "work_hub_task_assigned",
  category: "system",
  displayCategory,
  title: `Item ${id}`,
  body: null,
  link: "/work-hub",
  isRead: false,
  createdAt: timestamp,
});
const envelope = (items: any[], nextCursor: any = null) => ({
  items,
  nextCursor,
  categories,
});
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const listCalls = () =>
  apiFetch.mock.calls
    .map(([url]) => url as string)
    .filter(
      (url) =>
        url === "/api/notifications" || url.startsWith("/api/notifications?"),
    );
beforeEach(() => {
  vi.clearAllMocks();
  auth.generation = 0;
  params.category = undefined;
  __resetRateLimitForTests();
  apiFetch.mockImplementation(async (url: string) =>
    url.includes("/events") ? { currentSeq: 0, changed: false } : envelope([]),
  );
});
afterEach(() => {
  cleanup();
  __resetRateLimitForTests();
  vi.useRealTimers();
});

it("uses server categories above the list and pages 25 rows with the exact composite cursor, deduping appends", async () => {
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    return url.includes("beforeId")
      ? envelope([row(26), row(25), row(24)])
      : envelope(
          Array.from({ length: 25 }, (_, i) => row(50 - i)),
          { createdAt: timestamp, id: 26 },
        );
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-26");
  expect(screen.getAllByTestId(/^notification-\d+$/)).toHaveLength(25);
  expect(screen.getByTestId("notifications-tab-all").textContent).toBe("All");
  expect(screen.getByTestId("notifications-tab-tasks").textContent).toBe(
    "Tasks",
  );
  expect(
    screen
      .getAllByTestId(/^notifications-tab-/)
      .map((n) => n.textContent?.replace(/ \(\d+\)$/, "")),
  ).toEqual([
    "All",
    "Schedule",
    "Gate Crew",
    "Messages",
    "Handoffs",
    "Tasks",
    "Compliance",
    "Alerts",
  ]);
  expect(
    screen
      .getByTestId("notification-results")
      .contains(screen.getByTestId("notifications-category-row")),
  ).toBe(false);
  expect(
    screen
      .getByTestId("notification-results")
      .contains(screen.getByTestId("notifications-category-divider")),
  ).toBe(false);
  fireEvent.click(screen.getByTestId("load-more"));
  await screen.findByTestId("notification-24");
  expect(screen.getAllByTestId(/^notification-\d+$/)).toHaveLength(27);
  const query = new URL(listCalls()[1], "https://app.invalid").searchParams;
  expect(Object.fromEntries(query)).toEqual({
    limit: "25",
    category: "all",
    beforeCreatedAt: timestamp,
    beforeId: "26",
  });
  fireEvent.click(screen.getByTestId("load-more"));
  expect(listCalls()).toHaveLength(2);
});

it("resets the category and cursor immediately and ignores a late previous-category page", async () => {
  const pending = deferred();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (url.includes("beforeId")) return pending.promise;
    if (url.includes("category=messages"))
      return envelope([row(3, "messages")]);
    return envelope([row(20)], { createdAt: timestamp, id: 20 });
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-20");
  fireEvent.click(screen.getByTestId("load-more"));
  fireEvent.click(screen.getByTestId("notifications-tab-messages"));
  expect(screen.queryByTestId("notification-20")).toBeNull();
  await screen.findByTestId("notification-3");
  await act(async () =>
    pending.resolve(envelope([row(19)], { createdAt: timestamp, id: 19 })),
  );
  expect(screen.queryByTestId("notification-19")).toBeNull();
  expect(listCalls().at(-1)).toBe(
    "/api/notifications?limit=25&category=messages",
  );
});

it("hides old account rows and rejects its delayed mode/cursor response after a context change", async () => {
  const old = deferred();
  let first = true;
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (first) {
      first = false;
      return old.promise;
    }
    return [{ ...row(900), displayCategory: undefined, category: "tickets" }];
  });
  render(<NotificationsScreen />);
  act(() => {
    auth.generation++;
    auth.listeners.forEach((listener) => listener());
  });
  await screen.findByTestId("notification-900");
  await act(async () =>
    old.resolve(envelope([row(1)], { createdAt: timestamp, id: 1 })),
  );
  expect(screen.queryByTestId("notification-1")).toBeNull();
  expect(screen.getByTestId("notifications-tab-tickets")).toBeTruthy();
  expect(screen.queryByTestId("notifications-tab-gate_crew")).toBeNull();
  fireEvent.click(screen.getByTestId("load-more"));
  expect(listCalls()).toHaveLength(2);
});

it("preserves office arrays longer than 25 and their local category filters", async () => {
  apiFetch.mockImplementation(async (url: string) =>
    url.includes("/events")
      ? { currentSeq: 0, changed: false }
      : Array.from({ length: 40 }, (_, i) => ({
          ...row(i),
          displayCategory: undefined,
          category: i === 0 ? "tickets" : "hotlist",
        })),
  );
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-39");
  expect(screen.getAllByTestId(/^notification-\d+$/)).toHaveLength(40);
  expect(listCalls()).toEqual(["/api/notifications"]);
  fireEvent.click(screen.getByTestId("notifications-tab-tickets"));
  expect(screen.getAllByTestId(/^notification-\d+$/)).toHaveLength(1);
  expect(listCalls()).toHaveLength(1);
});

it("clears loaded rows and resets selection before the next account responds", async () => {
  const next = deferred();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (auth.generation) return next.promise;
    return envelope([row(7, "messages")]);
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-7");
  fireEvent.click(screen.getByTestId("notifications-tab-messages"));
  await screen.findByTestId("notification-7");
  act(() => {
    auth.generation++;
    auth.listeners.forEach((listener) => listener());
  });
  expect(screen.queryByTestId("notification-7")).toBeNull();
  expect(
    screen.getByTestId("notifications-tab-all").getAttribute("aria-selected"),
  ).toBe("true");
  await act(async () => next.resolve(envelope([row(8)])));
  expect(screen.getByTestId("notification-8")).toBeTruthy();
});

it("does not issue concurrent page requests and ignores a superseded page error after refreshing", async () => {
  const page = deferred();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    return url.includes("beforeId")
      ? page.promise
      : envelope([row(10)], { createdAt: timestamp, id: 10 });
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-10");
  fireEvent.click(screen.getByTestId("load-more"));
  fireEvent.click(screen.getByTestId("load-more"));
  expect(listCalls()).toHaveLength(2);
  fireEvent.click(screen.getByTestId("refresh"));
  await waitFor(() => expect(listCalls()).toHaveLength(3));
  await act(async () => page.reject(new Error("old network error")));
  expect(screen.queryByTestId("notifications-load-error")).toBeNull();
  expect(screen.getByTestId("notification-10")).toBeTruthy();
});

it("shows a category-specific empty state and keeps failed paging retryable without losing rows", async () => {
  let fail = true;
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (url.includes("category=messages")) return envelope([]);
    if (url.includes("beforeId")) {
      if (fail) throw new Error("offline");
      return envelope([row(9)]);
    }
    return envelope([row(10)], { createdAt: timestamp, id: 10 });
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-10");
  fireEvent.click(screen.getByTestId("load-more"));
  await screen.findByTestId("notifications-load-error");
  expect(screen.getByTestId("notification-10")).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByTestId("notifications-retry"));
  await screen.findByTestId("notification-9");
  fireEvent.click(screen.getByTestId("notifications-tab-messages"));
  await screen.findByText("No messages notifications yet.");
  expect(screen.queryByTestId("notifications-load-error")).toBeNull();
});

it("retries an office refresh after the shared notification cooldown expires", async () => {
  vi.useFakeTimers();
  let calls = 0;
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    calls++;
    if (calls === 2)
      throw Object.assign(new Error("slow down"), {
        status: 429,
        data: { code: "notifications.rate_limited", retryAfterSeconds: 2 },
      });
    return [{ ...row(calls === 1 ? 1 : 2), displayCategory: undefined }];
  });
  await act(async () => {
    render(<NotificationsScreen />);
  });
  expect(screen.getByTestId("notification-1")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByTestId("refresh")));
  expect(screen.getByTestId("notifications-slow-down-banner")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(2100));
  expect(screen.getByTestId("notification-2")).toBeTruthy();
  expect(calls).toBe(3);
});

it("honors a gate category URL after discovery and when the mounted route parameters change", async () => {
  params.category = "messages";
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (url.includes("category=messages"))
      return envelope([row(3, "messages")]);
    if (url.includes("category=tasks")) return envelope([row(4)]);
    return envelope([row(1)]);
  });
  const view = render(<NotificationsScreen />);
  await screen.findByTestId("notification-3");
  expect(screen.queryByTestId("notification-1")).toBeNull();
  params.category = "tasks";
  view.rerender(<NotificationsScreen />);
  await screen.findByTestId("notification-4");
  expect(screen.queryByTestId("notification-3")).toBeNull();
});

it("keeps a read-state change made while the next page is in flight", async () => {
  const page = deferred();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) return { currentSeq: 0, changed: false };
    if (url.endsWith("/read-all")) return { ok: true };
    return url.includes("beforeId")
      ? page.promise
      : envelope([row(10)], { createdAt: timestamp, id: 10 });
  });
  render(<NotificationsScreen />);
  await screen.findByTestId("notification-10");
  fireEvent.click(screen.getByTestId("load-more"));
  await act(async () =>
    fireEvent.click(screen.getByLabelText("notifications.markAll")),
  );
  expect(screen.getByTestId("notification-10").style.borderTopColor).toBe(
    "rgb(128, 128, 128)",
  );
  await act(async () => page.resolve(envelope([row(10), row(9)])));
  expect(screen.getByTestId("notification-10").style.borderTopColor).toBe(
    "rgb(128, 128, 128)",
  );
});

it.each(["refresh", "retry"])(
  "settles an office %s after changing its local category while the request is pending",
  async (operation) => {
    const pending = deferred();
    const replacement = deferred();
    let calls = 0;
    const officeRow = (id: number) => ({
      ...row(id),
      displayCategory: undefined,
      category: "tickets",
    });
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/events")) return { currentSeq: 0, changed: false };
      calls++;
      if (calls === 1) return [officeRow(1)];
      if (operation === "retry" && calls === 2) throw new Error("offline");
      const pendingCall = operation === "refresh" ? 2 : 3;
      return calls === pendingCall ? pending.promise : replacement.promise;
    });
    render(<NotificationsScreen />);
    await screen.findByTestId("notification-1");
    fireEvent.click(screen.getByTestId("refresh"));
    if (operation === "retry") {
      await screen.findByTestId("notifications-retry");
      fireEvent.click(screen.getByTestId("notifications-retry"));
    }
    const requestCount = operation === "refresh" ? 2 : 3;
    await waitFor(() => expect(listCalls()).toHaveLength(requestCount));
    fireEvent.click(screen.getByTestId("notifications-tab-tickets"));
    // Both preserving the original request and explicitly replacing it are valid;
    // neither path may discard the result and leave the spinner stuck.
    await act(async () => {
      pending.resolve([officeRow(2)]);
      replacement.resolve([officeRow(2)]);
    });
    await screen.findByTestId("notification-2");
    expect(screen.queryByTestId("notification-1")).toBeNull();
    expect(list.props.refreshControl.props.refreshing).toBe(false);
    expect(
      screen
        .getByTestId("notifications-tab-tickets")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(listCalls().every((url) => url === "/api/notifications")).toBe(true);
  },
);

it("retains live events during paging and coalesces them into one refresh after the page settles", async () => {
  vi.useFakeTimers();
  const page = deferred();
  let currentSeq = 0;
  let listRequests = 0;
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/events")) {
      const after = Number(
        new URL(url, "https://app.invalid").searchParams.get("after"),
      );
      return { currentSeq, changed: after < currentSeq };
    }
    listRequests++;
    if (url.includes("beforeId")) return page.promise;
    return currentSeq
      ? envelope([row(99), row(10)])
      : envelope([row(10)], { createdAt: timestamp, id: 10 });
  });
  await act(async () => {
    render(<NotificationsScreen />);
  });
  fireEvent.click(screen.getByTestId("load-more"));
  currentSeq = 7;
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  currentSeq = 11;
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(listRequests).toBe(2);
  await act(async () => page.resolve(envelope([row(9)])));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByTestId("notification-99")).toBeTruthy();
  expect(listRequests).toBe(3);
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(listRequests).toBe(3);
  const eventCalls = apiFetch.mock.calls
    .map(([url]) => url)
    .filter((url) => url.includes("/events"));
  expect(eventCalls.slice(0, 4)).toEqual(
    Array(4).fill("/api/notifications/events?transport=poll&after=0"),
  );
  expect(eventCalls.at(-1)).toBe(
    "/api/notifications/events?transport=poll&after=11",
  );
});
