import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  user: {
    id: 1,
    vendorId: 7,
    role: "vendor",
    vendorRole: "foreman",
    availableMemberships: [{ id: 1, role: "member" }],
  } as any,
}));
vi.mock("@/lib/api", () => ({ apiFetch: (path: string) => state.fetch(path) }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: state.user, activeMembershipId: 1 }),
}));
import { useUnifiedWorkCalendar } from "@/lib/use-unified-work-calendar";
function Harness() {
  const query = useUnifiedWorkCalendar({
    start: "2026-10-01T00:00:00Z",
    end: "2026-11-01T00:00:00Z",
  });
  return (
    <div>
      {query.isPending
        ? "Loading"
        : JSON.stringify(query.data ?? { error: true })}
    </div>
  );
}
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.user = {
    id: 1,
    vendorId: 7,
    role: "vendor",
    vendorRole: "foreman",
    availableMemberships: [{ id: 1, role: "member" }],
  };
  state.fetch.mockReset();
});
afterEach(cleanup);
it("loads Gate shifts and meetings without requesting Fleet or Field even for a full-suite company", async () => {
  state.user.vendorRole = "gate_supervisor";
  state.fetch.mockImplementation(async (path: string) => {
    if (path === "/api/company-operations")
      return { categories: ["field", "fleet", "gate"], canManage: false };
    if (path.startsWith("/api/work-hub/calendar"))
      return {
        shifts: [
          {
            item: {
              id: "gate-shift",
              gateStationId: "station",
              siteLocationId: 7,
              title: "Gate coverage",
              startsAt: "2026-10-13T12:00:00Z",
            },
          },
          {
            item: {
              id: "field-shift",
              title: "Field work",
              startsAt: "2026-10-13T12:00:00Z",
            },
          },
        ],
        meetings: [],
      };
    throw Error(path);
  });
  mount();
  await screen.findByText(/shift:gate-shift/);
  expect(screen.queryByText(/shift:field-shift/)).toBeNull();
  expect(
    state.fetch.mock.calls.every(
      ([p]) =>
        p === "/api/company-operations" ||
        p.startsWith("/api/work-hub/calendar"),
    ),
  ).toBe(true);
  expect(screen.getByText(/"fieldTicket":false/)).toBeTruthy();
  expect(screen.getByText(/"fleetRun":false/)).toBeTruthy();
  expect(screen.getByText(/"shift":true/)).toBeTruthy();
});
it("surfaces a calendar outage without inventing counts or requesting excluded modules", async () => {
  state.fetch.mockImplementation(async (path: string) => {
    if (path === "/api/company-operations")
      return { categories: ["fleet"], canManage: true };
    throw Error("offline");
  });
  mount();
  await screen.findByText(/"unavailable":\["calendar"\]/);
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/"items":\[\]/)).toBeTruthy();
});
it("does not query company calendar when unauthenticated", async () => {
  state.user = null;
  mount();
  await waitFor(() => expect(state.fetch).not.toHaveBeenCalled());
});
