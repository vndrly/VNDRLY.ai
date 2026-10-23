import React from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GateArrival } from "@workspace/api-zod";
import { GateArrivalsPanel, useGateArrivals } from "./gate-arrivals-panel";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/gate-arrivals-api", () => ({ gateArrivalsApi: api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 989, activeMembershipId: 727 } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => `${key}${values?.minutes == null ? "" : `:${values.minutes}`}` }) }));

const arrival: GateArrival = {
  id: "run1:stop1", runId: "run1", ticketId: 12, ticketNumber: "100012", title: "Delivery",
  driverName: "Pat Driver", vehicleLabel: "Truck 1", companyName: "FleetGo", status: "in_progress",
  phase: "traveling_to_delivery", etaMinutes: null, etaUnavailableReason: "route_unavailable",
  observedAt: "2026-10-22T12:00:00Z", destinationName: "Big Cs Deep", siteLocationId: 42, physicalProofVerified: false,
};

afterEach(() => { vi.useRealTimers(); });

describe("Gate incoming runs", () => {
  it("alerts once per incoming run, not again for each GPS update", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    api.list.mockResolvedValue({ arrivals: [arrival], truncated: false, generatedAt: "now" });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useGateArrivals(42), { wrapper });
    await waitFor(() => expect(hook.result.current.newInboundIds.has(arrival.id)).toBe(true));
    await waitFor(() => expect(hook.result.current.newInboundIds.size).toBe(0), { timeout: 6000 });
    act(() => {
      client.setQueryData(["gate-arrivals", 989, 727, 42], { arrivals: [{ ...arrival, observedAt: "later" }], truncated: false, generatedAt: "later" });
    });
    expect(hook.result.current.newInboundIds.size).toBe(0);
    hook.unmount(); client.clear();
  });

  it("opens only the record on click and reports unavailable ETA honestly", () => {
    const open = vi.fn();
    const query = { isLoading: false, isError: false, data: { arrivals: [arrival], truncated: false }, newInboundIds: new Set() } as ReturnType<typeof useGateArrivals>;
    render(<GateArrivalsPanel query={query} onOpen={open} />);
    screen.getByRole("button", { name: /Pat Driver/ }).click();
    expect(open).toHaveBeenCalledExactlyOnceWith("run1");
    expect(screen.getByText("gatekeeper.etaUnavailable")).toBeTruthy();
    expect(screen.queryByText(/gatekeeper.checkOut/)).toBeNull();
  });
  it("does not claim no arrivals when the bounded source list is incomplete", () => {
    const query = { isLoading: false, isError: false, data: { arrivals: [], truncated: true }, newInboundIds: new Set() } as unknown as ReturnType<typeof useGateArrivals>;
    render(<GateArrivalsPanel query={query} onOpen={vi.fn()} />);
    expect(screen.getByText("gatekeeper.arrivalsTruncated")).toBeTruthy();
    expect(screen.queryByText("gatekeeper.noArrivals")).toBeNull();
  });
});
