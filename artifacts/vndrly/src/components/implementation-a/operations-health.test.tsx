import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationsHealth } from "./operations-health";

const fetcher = vi.fn();
vi.stubGlobal("fetch", fetcher);

function renderHealth(admin = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OperationsHealth admin={admin} /></QueryClientProvider>);
}

beforeEach(() => fetcher.mockReset());

it("limits operations health to administrators", () => {
  renderHealth();
  expect(screen.getByText(/limited to company administrators/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it("shows named operating signals from the company-scoped health endpoint", async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({
    status: "attention_required",
    checkedAt: "2026-09-14T12:00:00.000Z",
    signals: { offlineBacklog: 2, terminalConflicts: 0, permissionDenials: 0, staleLocations: 1, failedAlerts: 0, unhealthyDisplays: 0, missingSafetyChain: true, transcriptionAvailable: true },
    attention: ["offline_backlog", "stale_locations", "missing_safety_chain"],
  }) });
  renderHealth(true);
  await waitFor(() => expect(screen.getByText("Attention required")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledWith("/api/implementation-a/operations-health", { credentials: "include" });
  expect(screen.getByText("Offline changes waiting: 2")).toBeTruthy();
  expect(screen.getByText("Stale live locations: 1")).toBeTruthy();
  expect(screen.getByText("Safety escalation chain: Missing")).toBeTruthy();
});