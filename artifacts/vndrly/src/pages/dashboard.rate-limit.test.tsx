import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

// Task #710 — verify the dashboard parks ALL three widget queries
// (summary, recent activity, ticket stats) when ANY of them returns
// a `dashboard.rate_limited` 429. The contract under test:
//
//   * a single 429 disables all three queries for the Retry-After
//     window — a refetch on focus/mount must NOT slip through and
//     re-trip the limiter, and
//   * a single calm slow-down banner replaces three error walls.

const summaryFetcher = vi.fn();
const activityFetcher = vi.fn();
const statsFetcher = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardSummary: ({ query }: { query: Record<string, unknown> }) =>
    useQuery({
      queryKey: ["dash-summary"],
      queryFn: summaryFetcher as () => Promise<unknown>,
      ...query,
    }),
  useGetRecentActivity: ({ query }: { query: Record<string, unknown> }) =>
    useQuery({
      queryKey: ["dash-activity"],
      queryFn: activityFetcher as () => Promise<unknown>,
      ...query,
    }),
  useGetTicketStats: ({ query }: { query: Record<string, unknown> }) =>
    useQuery({
      queryKey: ["dash-stats"],
      queryFn: statsFetcher as () => Promise<unknown>,
      ...query,
    }),
  // Task #505 — partner-only "Awaiting payment" tile pulls from this
  // hook. The rate-limit tests aren't focused on that widget, but the
  // dashboard renders the call unconditionally so we need a non-null
  // mock so the component doesn't blow up at import time.
  useGetAwaitingPaymentSummary: ({ query }: { query: Record<string, unknown> }) =>
    useQuery({
      queryKey: ["dash-awaiting-payment"],
      queryFn: async () => ({ totalApprovedCents: 0, count: 0, oldestApprovedAt: null }),
      ...query,
    }),
  getGetDashboardSummaryQueryKey: () => ["dash-summary"],
  getGetRecentActivityQueryKey: () => ["dash-activity"],
  getGetTicketStatsQueryKey: () => ["dash-stats"],
  getGetAwaitingPaymentSummaryQueryKey: () => ["dash-awaiting-payment"],
  // Admin-only reassignment-history aggregate widget. The dashboard
  // imports the hook unconditionally; the rate-limit tests don't
  // exercise the widget so a stable empty response is enough.
  useGetAdminReassignmentAggregate: ({ query }: { query?: Record<string, unknown> } = {}) =>
    useQuery({
      queryKey: ["dash-admin-reassignment-aggregate"],
      queryFn: async () => ({ totals: [], rows: [] }),
      ...(query ?? {}),
    }),
  getGetAdminReassignmentAggregateQueryKey: () => [
    "dash-admin-reassignment-aggregate",
  ],
  // Direct Partner→Vendor work-offer card. The dashboard renders the
  // hook unconditionally for vendor-role users (this test's mocked
  // user) so the mock must return a stable empty list to keep the
  // rate-limit assertions focused on the three widgets above.
  useListDirectAssignments: ({ query }: { query?: Record<string, unknown> } = {}) =>
    useQuery({
      queryKey: ["dash-direct-assignments"],
      queryFn: async () => [],
      ...(query ?? {}),
    }),
  getListDirectAssignmentsQueryKey: () => ["dash-direct-assignments"],
  // Vendor users on the dashboard can Commit/Pass an offer inline.
  // The hooks are imported unconditionally at module load so the mock
  // must expose stable, no-op mutate/mutateAsync wrappers — the
  // rate-limit tests don't exercise the buttons themselves.
  useCommitDirectAssignment: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
    isLoading: false,
    reset: vi.fn(),
  }),
  usePassDirectAssignment: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
    isLoading: false,
    reset: vi.fn(),
  }),
}));

// Mock the heavy children so the dashboard render stays focused on
// the rate-limit banner + the three widget queries we care about.
vi.mock("@/components/hotlist-section", () => ({
  default: () => <div data-testid="hotlist-stub" />,
}));
vi.mock("@/components/finish-setup-widget", () => ({
  default: () => <div data-testid="finish-setup-stub" />,
}));
vi.mock("@/components/assistant-metrics-card", () => ({
  AssistantMetricsCard: () => <div data-testid="assistant-stub" />,
}));
vi.mock("@/components/rate-limit-budgets-card", () => ({
  RateLimitBudgetsCard: () => <div data-testid="budgets-stub" />,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, role: "vendor" } }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: false, primary: "#000" }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()] as const,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Recharts uses ResizeObserver — install a no-op polyfill so the
// chart card can mount without crashing jsdom.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

import Dashboard from "./dashboard";

function rateLimitError(retryAfterSeconds: number) {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      error: "rate_limited",
      code: "dashboard.rate_limited",
      retryAfterSeconds,
    },
    headers: new Headers(),
  });
}

function renderWithClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  summaryFetcher.mockReset();
  activityFetcher.mockReset();
  statsFetcher.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dashboard — rate-limit gate (Task #710)", () => {
  it("parks all three widgets when summary returns a `dashboard.rate_limited` 429", async () => {
    // The summary 429 is enough to trip the gate; all three queries
    // share the same code, so disabling rate_limited must propagate
    // to every widget. We assert by:
    //   1. only summary fetched once + rejected (no retry on 429)
    //   2. activity + stats also see a single attempt then are gated off
    //   3. invalidating queries (focus/mount churn equivalent) does
    //      not re-fire any of them while the gate is parked
    summaryFetcher.mockRejectedValue(rateLimitError(60));
    activityFetcher.mockResolvedValue([]);
    statsFetcher.mockResolvedValue([]);

    const { rerender } = renderWithClient();

    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-slow-down")).not.toBeNull();
    });

    // Each fetcher is called at most once before the gate parks them.
    // (`enabled: false` after the first render kicks in via the local
    // mirror state set in a useEffect.)
    expect(summaryFetcher).toHaveBeenCalledTimes(1);
    expect(activityFetcher.mock.calls.length).toBeLessThanOrEqual(1);
    expect(statsFetcher.mock.calls.length).toBeLessThanOrEqual(1);

    const summaryCalls = summaryFetcher.mock.calls.length;
    const activityCalls = activityFetcher.mock.calls.length;
    const statsCalls = statsFetcher.mock.calls.length;

    // A re-render (simulates focus/mount churn) must NOT trigger
    // another fetch on any widget while the gate is parked.
    await act(async () => {
      rerender(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: {
                queries: { retry: false, refetchOnWindowFocus: false },
              },
            })
          }
        >
          <Dashboard />
        </QueryClientProvider>,
      );
    });
    // Advance timers a chunk inside the 60s Retry-After window — no
    // poll interval is configured on these queries, but this proves
    // no stray timer-based refetch fires either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(summaryFetcher.mock.calls.length).toBe(summaryCalls);
    expect(activityFetcher.mock.calls.length).toBe(activityCalls);
    expect(statsFetcher.mock.calls.length).toBe(statsCalls);
    expect(screen.queryByTestId("dashboard-slow-down")).not.toBeNull();
  });

  it("does NOT park on a 500 from any widget — the slow-down banner is reserved for true 429 backoffs", async () => {
    summaryFetcher.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500, data: {} }),
    );
    activityFetcher.mockResolvedValue([]);
    statsFetcher.mockResolvedValue([]);

    renderWithClient();

    await waitFor(() => {
      expect(summaryFetcher).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("dashboard-slow-down")).toBeNull();
  });

  it("ignores 429s coded for a different resource (cross-resource isolation)", async () => {
    summaryFetcher.mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), {
        status: 429,
        data: { code: "visits.rate_limited", retryAfterSeconds: 30 },
        headers: new Headers(),
      }),
    );
    activityFetcher.mockResolvedValue([]);
    statsFetcher.mockResolvedValue([]);

    renderWithClient();

    await waitFor(() => {
      expect(summaryFetcher).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("dashboard-slow-down")).toBeNull();
  });
});
