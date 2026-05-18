import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #709 — UI safety net for the per-resource throttle budgets
// dashboard. The page is the operator-facing surface for the
// existing `GET /api/admin/rate-limit-budgets` endpoint (already
// covered server-side by dashboard-rate-limit-budgets-multi.test.ts).
// What we lock in here is purely the rendering contract:
//   • a card per endpoint in the response
//   • a per-role row inside each card with the resolved Max value
//   • the "Overridden" pill on rows whose budget differs from the
//     default (this is the one operator-visible signal that an env
//     override actually took effect, so a regression that drops it
//     would defeat the entire purpose of the page)
//   • non-admins are bounced with the same "Admin role required."
//     short-circuit the rest of the admin pages use, so a stray nav
//     link can't leak limiter config to a vendor/partner session
//
// We mock useAuth to flip role and `globalThis.fetch` to return a
// canned RATE_LIMIT_BUDGETS payload. No router / no real API is
// involved; the page reads `import.meta.env.BASE_URL` at module
// load and we don't care what URL fetch sees, only that it was
// called and the response shape rendered.

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverPolyfill;
}

const { currentUser } = vi.hoisted(() => ({
  currentUser: { value: null as { role: string } | null },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: currentUser.value, isLoading: false }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import AdminRateLimits from "./admin-rate-limits";

const SAMPLE_PAYLOAD = {
  endpoints: [
    {
      key: "tickets",
      label: "Tickets API",
      description: "Ticket list and detail reads",
      routes: ["GET /api/tickets", "GET /api/tickets/:id"],
      default: { max: 30, windowMs: 10000 },
      roles: [
        {
          role: "admin",
          max: 30,
          windowMs: 10000,
          overridden: false,
          recentTrips: 0,
        },
        {
          role: "vendor",
          max: 60,
          windowMs: 10000,
          overridden: true,
          recentTrips: 12,
        },
      ],
      envVarHint: {
        max: "TICKETS_RATE_LIMIT_MAX_<ROLE>",
        windowMs: "TICKETS_RATE_LIMIT_WINDOW_MS_<ROLE>",
      },
      recentTripsWindowMs: 15 * 60 * 1000,
      recentTripsUnknown: 2,
      recentTripsTotal: 14,
    },
    {
      key: "visits",
      label: "Visits API",
      description: "Visitor list and detail reads",
      routes: ["GET /api/visits"],
      default: { max: 30, windowMs: 10000 },
      roles: [
        {
          role: "admin",
          max: 30,
          windowMs: 10000,
          overridden: false,
          recentTrips: 0,
        },
        {
          role: "vendor",
          max: 30,
          windowMs: 10000,
          overridden: false,
          recentTrips: 0,
        },
      ],
      envVarHint: {
        max: "VISITS_RATE_LIMIT_MAX_<ROLE>",
        windowMs: "VISITS_RATE_LIMIT_WINDOW_MS_<ROLE>",
      },
      recentTripsWindowMs: 15 * 60 * 1000,
      recentTripsUnknown: 0,
      recentTripsTotal: 0,
    },
  ],
  store: { kind: "memory", prefix: null },
};

function renderPage() {
  // A fresh QueryClient per render so tests don't share cached
  // budgets — each case must drive its own fetch through the
  // recorded mock.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdminRateLimits />
    </QueryClientProvider>,
  );
}

describe("AdminRateLimits page", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SAMPLE_PAYLOAD,
    }));
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    currentUser.value = null;
    vi.restoreAllMocks();
  });

  it("non-admins see the role-required short-circuit and we never hit the API", () => {
    currentUser.value = { role: "vendor" };
    renderPage();
    expect(screen.getByText("Admin role required.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("admins get one card per endpoint with per-role rows and an overridden pill", async () => {
    currentUser.value = { role: "admin" };
    renderPage();

    // Wait for the query to resolve.
    await waitFor(() =>
      expect(screen.getByTestId("card-rate-limit-tickets")).toBeTruthy(),
    );
    expect(screen.getByTestId("card-rate-limit-visits")).toBeTruthy();

    // The overridden vendor row on tickets should carry the pill;
    // the non-overridden admin row should NOT.
    expect(
      screen.getByTestId("badge-overridden-tickets-vendor"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("badge-overridden-tickets-admin"),
    ).toBeNull();

    // Visits has no overrides → no pill anywhere on that card.
    expect(
      screen.queryByTestId("badge-overridden-visits-admin"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-overridden-visits-vendor"),
    ).toBeNull();

    // The Max cell reflects the per-role resolved value (60 for
    // the overridden vendor row, default 30 for admin).
    expect(
      screen.getByTestId("cell-max-tickets-vendor").textContent,
    ).toContain("60");
    expect(
      screen.getByTestId("cell-max-tickets-admin").textContent,
    ).toContain("30");

    // Aggregate "N roles overridden" pill appears only on the card
    // with at least one overridden role.
    expect(
      screen
        .getByTestId("badge-overridden-count-tickets")
        .textContent?.replace(/\s+/g, " ")
        .trim(),
    ).toBe("1 role overridden");
    expect(
      screen.queryByTestId("badge-overridden-count-visits"),
    ).toBeNull();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("/api/admin/rate-limit-budgets");
  });

  it("renders per-role recent-trip counts and the card-level total pill (Task #763)", async () => {
    currentUser.value = { role: "admin" };
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("card-rate-limit-tickets")).toBeTruthy(),
    );

    // Tickets has 14 trips total in the last 15 min — the operator
    // should see that summary pill on the card header so they don't
    // have to scan the table to spot a noisy endpoint.
    expect(
      screen
        .getByTestId("badge-trips-total-tickets")
        .textContent?.replace(/\s+/g, " ")
        .trim(),
    ).toBe("tripped 14× in the last 15 min");

    // Per-role cells reflect the resolved counts: vendor 12×, admin
    // 0×. The admin readout is what tells an operator at a glance
    // which role is actually hitting the cap.
    expect(
      screen.getByTestId("cell-recent-trips-tickets-vendor").textContent,
    ).toContain("12");
    expect(
      screen.getByTestId("cell-recent-trips-tickets-admin").textContent,
    ).toContain("0");

    // Unknown/unauthenticated trips are surfaced separately so an
    // under-sized default that's only being tripped by guests
    // doesn't go invisible.
    expect(
      screen.getByTestId("text-trips-unknown-tickets").textContent,
    ).toContain("2×");

    // Visits has zero trips → no header pill, no unknown caption.
    expect(screen.queryByTestId("badge-trips-total-visits")).toBeNull();
    expect(screen.queryByTestId("text-trips-unknown-visits")).toBeNull();
    // But the per-role cell still shows the 0 so the column is
    // legible even when nothing is tripping.
    expect(
      screen.getByTestId("cell-recent-trips-visits-vendor").textContent,
    ).toContain("0");
  });

  it("hides the trip count UI when the API omits the field (back-compat)", async () => {
    // Older API replicas that haven't shipped Task #763 yet won't
    // return `recentTripsWindowMs` / `recentTripsTotal`. The page
    // must degrade gracefully — no header pill, no Trips column,
    // no "0×" cells that would lie about activity.
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        endpoints: [
          {
            key: "tickets",
            label: "Tickets API",
            description: "Ticket list and detail reads",
            routes: ["GET /api/tickets"],
            default: { max: 30, windowMs: 10000 },
            roles: [
              { role: "admin", max: 30, windowMs: 10000, overridden: false },
            ],
            envVarHint: {
              max: "TICKETS_RATE_LIMIT_MAX_<ROLE>",
              windowMs: "TICKETS_RATE_LIMIT_WINDOW_MS_<ROLE>",
            },
          },
        ],
      }),
    }));
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchSpy as unknown as typeof fetch;
    currentUser.value = { role: "admin" };
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("card-rate-limit-tickets")).toBeTruthy(),
    );
    expect(screen.queryByTestId("badge-trips-total-tickets")).toBeNull();
    expect(screen.queryByTestId("th-trips-tickets")).toBeNull();
    expect(
      screen.queryByTestId("cell-recent-trips-tickets-admin"),
    ).toBeNull();
  });

  // Task #776 — the readout has to tell operators which BucketStore
  // backend the API server resolved to. The whole point of the
  // separate card is letting on-call confirm at a glance whether a
  // given replica is sharing counters or running standalone, so
  // both states need an assertion.
  it("renders the in-process backing-store note when the API resolved to memory", async () => {
    currentUser.value = { role: "admin" };
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("card-rate-limit-store")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("badge-rate-limit-store-kind").textContent,
    ).toContain("memory");
    // No prefix shown for the in-process store — there's no shared
    // keyspace to scope.
    expect(
      screen.queryByTestId("text-rate-limit-store-prefix"),
    ).toBeNull();
  });

  it("renders the Redis backing-store note + key prefix when the API resolved to Redis", async () => {
    currentUser.value = { role: "admin" };
    fetchSpy.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...SAMPLE_PAYLOAD,
        store: { kind: "redis", prefix: "vndrly:rl:" },
      }),
    }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("card-rate-limit-store")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("badge-rate-limit-store-kind").textContent,
    ).toContain("redis");
    expect(
      screen.getByTestId("text-rate-limit-store-prefix").textContent,
    ).toContain("vndrly:rl:");
  });
});
