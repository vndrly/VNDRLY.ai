import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Task #710 — verify the visitor list calmly backs off when the
// server returns a `visits.rate_limited` 429 with a Retry-After.
// The contract under test:
//
//   * the next 30 s poll must be SUPPRESSED (otherwise we'd
//     immediately re-trip the limiter and never recover), and
//   * a calm slow-down banner must appear in place of the error
//     wall, so the user knows we're paused, not broken.

vi.mock("@/lib/visits-api", () => ({
  visitsApi: {
    list: vi.fn(),
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  useListSiteLocations: () => ({ data: [] }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/visitors", vi.fn()] as const,
}));

import VisitorsPage from "./visitors";
import { visitsApi } from "@/lib/visits-api";

function rateLimitError(retryAfterSeconds: number) {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    data: {
      error: "rate_limited",
      code: "visits.rate_limited",
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
      <VisitorsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (visitsApi.list as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("visitors page — rate-limit gate (Task #710)", () => {
  it("suppresses the 30 s poll and shows a calm slow-down banner after a 429", async () => {
    // First poll trips the limiter with a 60 s Retry-After. The next
    // 30 s poll tick would otherwise re-fire and immediately re-trip
    // the limiter — the gate must suppress it.
    (visitsApi.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      rateLimitError(60),
    );
    (visitsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderWithClient();

    // The initial fetch fires; once it rejects we expect the gate to
    // park polling and reveal the slow-down banner.
    await waitFor(() => {
      expect(screen.queryByTestId("visitors-slow-down")).not.toBeNull();
    });
    const callsAfterFirst = (visitsApi.list as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(callsAfterFirst).toBe(1);

    // Advance past the 30 s poll interval but still inside the 60 s
    // Retry-After window. The would-be poll tick must produce ZERO
    // additional fetches because `enabled: false` halts the refetch
    // loop while the gate is parked.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(
      (visitsApi.list as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsAfterFirst);
    // Banner is still showing the parked state mid-window.
    expect(screen.queryByTestId("visitors-slow-down")).not.toBeNull();
  });

  it("does NOT park on a non-429 error — the regular error path stays intact", async () => {
    (visitsApi.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("boom"), {
        status: 500,
        data: { error: "internal" },
        headers: new Headers(),
      }),
    );

    renderWithClient();

    // Allow the query to settle; we check that the slow-down banner
    // is NOT shown (it must be reserved for true 429 rate-limit
    // backoffs, not generic outages).
    await waitFor(() => {
      expect(
        (visitsApi.list as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId("visitors-slow-down")).toBeNull();
  });

  it("ignores 429s coded for a different resource (cross-resource isolation)", async () => {
    // A `dashboard.rate_limited` 429 must NOT park the visitor list —
    // it would silence an unrelated UI when the wrong limiter trips.
    (visitsApi.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), {
        status: 429,
        data: {
          error: "rate_limited",
          code: "dashboard.rate_limited",
          retryAfterSeconds: 30,
        },
        headers: new Headers(),
      }),
    );

    renderWithClient();

    await waitFor(() => {
      expect(
        (visitsApi.list as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId("visitors-slow-down")).toBeNull();
  });
});
