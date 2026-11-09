import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { seconds?: number; count?: number }) => {
      if (key === "notifications.slowDown.retryIn" && opts?.seconds != null) {
        return `retry in ${opts.seconds}s`;
      }
      return key;
    },
  }),
}));
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
  useLocation: () => ["/tickets", vi.fn()] as const,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { userId: 42, role: "partner", partnerId: 1, vendorId: null },
  }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "Exxon", logoUrl: null, primary: "#cc0000" }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolved: "light" as const }),
}));
vi.mock("@/lib/portal-branding", () => ({
  portalDisplayLogo: () => "/logo.png",
}));
vi.mock("@/components/notification-send-to-dialog", () => ({
  default: () => null,
}));

import NotificationsModal from "@/components/notifications-modal";
import { notificationsApi } from "@/lib/notifications-api";

function renderModal(open = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsModal open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(notificationsApi, "unreadCount").mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationsModal list states", () => {
  it("preserves the exact staffing calendar destination on a mapped notification row", async () => {
    const href = "/work-hub/calendar?siteId=21&stationId=west&shiftId=night-1&date=2026-11-09";
    vi.spyOn(notificationsApi, "list").mockResolvedValue([{
      id: 8, userId: 42, type: "gate_coverage_uncovered", category: "system", dedupeKey: "staffing:one",
      title: "Staffing gap", body: "West Gate needs coverage", link: href, isRead: false, createdAt: new Date().toISOString(),
    }]);
    renderModal();
    const row = await screen.findByTestId("modal-notification-8");
    expect(row.closest("a")?.getAttribute("href")).toBe(href);
  });
  it("shows a retry affordance instead of infinite loading when the list fetch fails", async () => {
    vi.spyOn(notificationsApi, "list").mockRejectedValue(
      Object.assign(new Error("Server error"), {
        status: 429,
        data: { code: "other.rate_limited" },
      }),
    );

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("modal-notifications-retry")).toBeTruthy();
    });
    expect(screen.getByText("notifications.loadFailed")).toBeTruthy();
    expect(screen.queryByText("notifications.loading")).toBeNull();
  });

  it("renders rows after a successful fetch", async () => {
    vi.spyOn(notificationsApi, "list").mockResolvedValue([
      {
        id: 7,
        userId: 42,
        type: "ticket_assigned",
        category: "tickets",
        dedupeKey: null,
        title: "Assigned",
        body: "Body",
        link: "/tickets/1",
        isRead: false,
        createdAt: new Date().toISOString(),
      },
    ]);

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("modal-notification-7")).toBeTruthy();
    });
    expect(screen.queryByText("notifications.loading")).toBeNull();
  });
});
