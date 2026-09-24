import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

const { apiFetch, push, syncBadge, params } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  syncBadge: vi.fn(),
  params: { requestId: "" },
}));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/notificationBadge", () => ({ syncAppIconBadge: syncBadge }));
vi.mock("@/lib/notificationSounds", () => ({ stopBellTolling: vi.fn() }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/components/AdaptiveNavigationShell", () => ({ REGULAR_NAVIGATION_BREAKPOINT: 768 }));
vi.mock("react-native-svg", () => ({ default: () => null, Defs: () => null, LinearGradient: () => null, Rect: () => null, Stop: () => null }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "orange", card: "white" }),
}));
vi.mock("expo-router", () => ({
  router: { push },
  Stack: { Screen: () => null },
  usePathname: () => "/(tabs)/gate-notifications",
  useLocalSearchParams: () => params,
  useFocusEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string) {
  return key;
}
vi.mock("@/components/PortalPageHeader", () => ({ default: () => null }));
vi.mock("@/components/InPageHeader", () => ({ default: () => null }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: () => null }));
vi.mock("@/components/ScreenSafeArea", () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/components/NotificationActionModal", () => ({
  default: () => null,
}));
vi.mock("@/components/NotificationSendToModal", () => ({
  default: () => null,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, testID }: any) => (
    <button data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));

import NotificationsScreen from "../notifications";
import DestinationScreen from "../work-hub/notification";

const row = {
  id: 42,
  type: "work_hub_task_assigned",
  category: "system",
  displayCategory: "tasks",
  title: "Gate task",
  body: null,
  link: "/stale-link",
  isRead: false,
  createdAt: "2026-09-24T12:00:00Z",
};
const href =
  "/(tabs)/work-hub?section=my-work&task=7b077b60-17aa-4e3b-9d23-f622311ff274";

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/api/notifications")
      return { items: [row], nextCursor: null, categories: ["tasks"] };
    if (path.endsWith("/resolve")) return { href };
    if (path.includes("/calendar/items/task/"))
      return {
        item: {
          id: "7b077b60-17aa-4e3b-9d23-f622311ff274",
          title: "Exact gate task",
        },
      };
    if (path.includes("/events")) return { currentSeq: 0, changed: false };
    return { ok: true };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("consumes a gate envelope and opens its authorized exact item before marking read", async () => {
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByTestId("notification-42"));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/work-hub\/notification\?requestId=/),
    ),
  );
  expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
    false,
  );
  params.requestId = new URL(
    push.mock.calls[0][0],
    "https://app.invalid",
  ).searchParams.get("requestId")!;
  render(<DestinationScreen />);
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith("/api/notifications/42/read", {
      method: "POST",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(screen.getByText("Exact gate task")).toBeTruthy();
  const readIndex = apiFetch.mock.calls.findIndex(([path]) =>
    path.endsWith("/read"),
  );
  expect(push.mock.invocationCallOrder[0]).toBeLessThan(
    apiFetch.mock.invocationCallOrder[readIndex],
  );
  await waitFor(() => expect(screen.getByTestId("notification-42").style.borderTopColor).not.toBe("rgb(255, 165, 0)"));
});

it.each(["reject", "external"])(
  "keeps failed %s destinations unread and shows neutral unavailable copy",
  async (failure) => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const original = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) {
        if (failure === "reject")
          throw new Error("404 notification.unavailable");
        return { href: "https://evil.example" };
      }
      return original(path);
    });
    render(<NotificationsScreen />);
    fireEvent.click(await screen.findByTestId("notification-42"));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "common.error",
        "notifications.destinationUnavailable",
      ),
    );
    expect(push).not.toHaveBeenCalled();
    expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
      false,
    );
    expect(screen.getByTestId("notification-42").style.borderTopColor).toBe("rgb(255, 165, 0)");
  },
);
