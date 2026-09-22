import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryGateReportRows = vi.hoisted(() => vi.fn());
const changeOverRequest = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/content-pane-back-link", () => ({
  default: () => React.createElement("a", { href: "/gate" }, "Back"),
}));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest }));
vi.mock("@/components/gate-report-toolbar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/gate-report-toolbar")>()),
  queryGateReportRows,
}));

import GateHistoryPage from "./gate-history";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  queryGateReportRows.mockReset();
  changeOverRequest.mockReset();
});

beforeEach(() => {
  changeOverRequest.mockImplementation((path: string) => path === "/sites"
    ? Promise.resolve({ sites: [{ id: 42, name: "Acme HQ" }] })
    : Promise.resolve({ stations: [{ id: "00000000-0000-4000-8000-000000000042", name: "Main gate" }] }));
});

describe("GateHistoryPage plate display", () => {
  it("shows a branded, shadow-free History icon beside the page heading", () => {
    queryGateReportRows.mockResolvedValue([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={queryClient}><GateHistoryPage /></QueryClientProvider>);
    const icon = screen.getByTestId("gate-history-header-icon");
    expect(icon.getAttribute("class")).toContain("text-[var(--brand-primary)]");
    expect(icon.getAttribute("class")).not.toContain("card-icon-drop-shadow");
  });
  it("renders the state-qualified plate in the history row", async () => {
    window.history.replaceState({}, "", "/gate/history?siteLocationId=42");
    queryGateReportRows.mockResolvedValue([{
      id: "visit:88",
      name: "Taylor Reed",
      company: "Acme",
      vehiclePlate: "ABC123",
      plateState: "TX",
      checkInTime: "2026-08-27T12:00:00Z",
      checkOutTime: null,
    }]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GateHistoryPage />
      </QueryClientProvider>,
    );

    expect((await screen.findByTestId("gate-history-row")).textContent).toContain("TX • ABC123");
    expect(queryGateReportRows).toHaveBeenCalledWith("history", expect.objectContaining({ siteId: 42, range: "current_shift" }));
  });
  it("uses the branded search pill and lets the selected range drive the list", async () => {
    queryGateReportRows.mockResolvedValue([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={queryClient}><GateHistoryPage /></QueryClientProvider>);
    const search = screen.getByRole("textbox", { name: "gatekeeper.historySearch" });
    expect(search.className).toContain("rounded-full");
    expect(search.className).toContain("border-[color:var(--brand-primary)]");
    const range = screen.getByRole("combobox", { name: "History range" });
    expect(Array.from(range.querySelectorAll("option"), (option) => option.value)).toEqual(["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y"]);
    expect((range as HTMLSelectElement).value).toBe("current_shift");
    await waitFor(() => expect(queryGateReportRows).toHaveBeenCalledTimes(1));
    fireEvent.change(range, { target: { value: "7d" } });
    await waitFor(() => expect(queryGateReportRows).toHaveBeenCalledTimes(2));
    expect(queryGateReportRows.mock.calls[1][1]).toMatchObject({ range: "7d" });
  });
  it("exports only the rows shown after the active search", async () => {
    queryGateReportRows.mockImplementation((_kind: string, filters: { search?: string }) => Promise.resolve(filters.search
      ? [{ id: "visit:1", name: "Taylor Reed", company: "Acme", vehiclePlate: "ABC123", plateState: "TX", checkInTime: "2026-09-20T12:00:00Z" }]
      : [
          { id: "visit:1", name: "Taylor Reed", company: "Acme", vehiclePlate: "ABC123", plateState: "TX", checkInTime: "2026-09-20T12:00:00Z" },
          { id: "visit:2", name: "Sam Ortiz", company: "Acme", vehiclePlate: "XYZ789", plateState: "OK", checkInTime: "2026-09-20T12:00:00Z" },
        ]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={queryClient}><GateHistoryPage /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByTestId("gate-history-row")).toHaveLength(2));
    fireEvent.change(screen.getByRole("textbox", { name: "gatekeeper.historySearch" }), { target: { value: "Taylor" } });
    await waitFor(() => expect(screen.getAllByTestId("gate-history-row")).toHaveLength(1));
    expect(queryGateReportRows).toHaveBeenLastCalledWith("history", expect.objectContaining({ search: "Taylor" }));
  });
});
