import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryGateReportRows = vi.hoisted(() => vi.fn());
const changeOverRequest = vi.hoisted(() => vi.fn());
const incoming = vi.hoisted(() => vi.fn());
const correctGatePresence = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorRole: "gatekeeper" } }) }));
vi.mock("@/lib/visits-api", () => ({ visitsApi: { correctGatePresence } }));
vi.mock("@/lib/gate-arrivals-api", () => ({ gateArrivalsApi: { list: incoming } }));

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
  correctGatePresence.mockReset();
});

beforeEach(() => {
  incoming.mockResolvedValue({ arrivals: [{id:"arrival",runId:"run",title:"Inbound run",driverName:"Incoming driver",companyName:"Hauler",vehicleLabel:"Truck 7",ticketNumber:"T7",etaMinutes:10}], truncated:false });
  changeOverRequest.mockImplementation((path: string) => path.startsWith("/sites")
    ? Promise.resolve({ sites: [{ id: 42, name: "Acme HQ" }] })
    : Promise.resolve({ stations: [{ id: "00000000-0000-4000-8000-000000000042", name: "Main gate" }] }));
});

describe("GateHistoryPage plate display", () => {
  it("opens a crossing from another linked site using the selected gate's shared report scope", async () => {
    const stationId="00000000-0000-4000-8000-000000000042";
    window.history.replaceState({}, "", `/gate/history?siteId=42&stationId=${stationId}&recordId=visit%3A88`);
    queryGateReportRows.mockImplementation(async (_kind, filters) => filters.recordId && filters.stationId===stationId
      ? [{id:"visit:88",siteLocationId:43,name:"Parallel gate driver",gateName:"Entry gate A",exitGateName:"Exit gate B",checkInTime:"2026-10-28T12:00:00Z",checkOutTime:"2026-10-28T13:00:00Z"}] : []);
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><GateHistoryPage/></QueryClientProvider>);
    const dialog=await screen.findByRole("dialog");
    await waitFor(()=>expect(dialog.textContent).toContain("Exit gate B"));
    expect(dialog.textContent).toContain("Entry gate A");
    expect(queryGateReportRows).toHaveBeenCalledWith("history",expect.objectContaining({siteId:42,stationId,recordId:"visit:88"}));
  });
  it("pages mixed traffic 25 at a time with branded arrows and resets after filtering", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({ id: `visit:${index + 1}`, name: `Driver ${index + 1}`, checkInTime: new Date(Date.UTC(2026, 9, 28, 12, index)).toISOString() }));
    queryGateReportRows.mockResolvedValue(records);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    await screen.findByText("1–25 of 52 Records");
    expect(screen.getAllByTestId("gate-history-row")).toHaveLength(25);
    expect((screen.getByRole("button", { name: "Previous records" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId("sphere-back-circle")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Next records" }));
    expect(screen.getByText("26–50 of 52 Records")).toBeTruthy();
    expect(screen.getAllByTestId("gate-history-row")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Next records" }));
    expect(screen.getByText("51–52 of 52 Records")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next records" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Incoming driver")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On Site" }));
    await screen.findByText("1–25 of 51 Records");
    expect((screen.getByRole("button", { name: "Previous records" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Incoming driver")).toBeNull();
  });
  it("shows a dashboard-selected crossing in Gate Log itself, even outside the current range or status filter", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=on_site&recordId=visit%3A88&view=record");
    queryGateReportRows.mockImplementation(async (_kind, filters) => filters.recordId
      ? [{ id: "visit:88", name: "Old departed driver", checkInTime: "2026-08-01T12:00:00Z", checkOutTime: "2026-08-01T13:00:00Z" }]
      : [{ id: "visit:99", name: "Other crossing", checkInTime: "2026-10-28T12:00:00Z" }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    await screen.findByText("Old departed driver");
    expect(screen.getAllByTestId("gate-history-row")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Incoming driver")).toBeNull();
    expect(queryGateReportRows).toHaveBeenCalledWith("history", expect.objectContaining({ siteId: 42, recordId: "visit:88", recordType: "all" }));
    expect(window.location.search).toContain("view=record");
    fireEvent.click(screen.getByRole("button", { name: /^All$/ }));
    await screen.findByText("Other crossing");
    await waitFor(() => expect(window.location.search).not.toContain("recordId="));
    expect(window.location.search).not.toContain("view=record");
  });
  it("opens an exact historical record popup for existing quick-view links independently of list filters", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=check_outs&recordId=visit%3A88");
    queryGateReportRows.mockImplementation(async (_kind, filters) => filters.recordId ? [{ id: "visit:88", name: "Old departed driver", checkInTime: "2026-08-01T12:00:00Z", checkOutTime: "2026-08-01T13:00:00Z", notes: "Original crossing note" }] : []);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Original crossing note"));
    expect(queryGateReportRows).toHaveBeenCalledWith("history", expect.objectContaining({ siteId: 42, recordId: "visit:88", recordType: "all" }));
    expect(window.location.search).toContain("recordId=visit%3A88");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(window.location.search).not.toContain("recordId="));
    expect(screen.getByRole("button", { name: "Departures" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("uses the On Site view for an employee record link", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=employees_on_site&recordId=employee%3A42");
    queryGateReportRows.mockImplementation(async (_kind, filters) => filters.recordId ? [{ id: "employee:42", kind: "employee", name: "On-site employee" }] : []);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "On-site employee" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "On Site" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("corrects a missed checkout in one click and removes the stale truck after refresh", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=on_site");
    const visit = { id: "visit:88", name: "Taylor Reed", checkOutTime: null };
    queryGateReportRows.mockResolvedValue([visit]);
    correctGatePresence.mockImplementation(async () => { queryGateReportRows.mockResolvedValue([]); });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={cache}><GateHistoryPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Check out: Taylor Reed" }));
    await waitFor(() => expect(correctGatePresence).toHaveBeenCalledWith(88, expect.any(String)));
    await waitFor(() => expect(screen.queryByText("Taylor Reed")).toBeNull());
  });
  it("keeps the record on failure and safely retries with the same correction key", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=on_site");
    queryGateReportRows.mockResolvedValue([{ id: "visit:88", name: "Taylor Reed" }]);
    correctGatePresence.mockRejectedValue(new Error("Correction not saved"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Check out: Taylor Reed" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Correction not saved");
    expect(screen.getByText("Taylor Reed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check out: Taylor Reed" }));
    await waitFor(() => expect(correctGatePresence).toHaveBeenCalledTimes(2));
    expect(correctGatePresence.mock.calls[1]).toEqual(correctGatePresence.mock.calls[0]);
  });
  it("never checks out employee field work or records already corrected or departed", async () => {
    window.history.replaceState({}, "", "/gate/history?siteId=42&recordType=on_site");
    queryGateReportRows.mockResolvedValue([
      { id: "employee:88", name: "Field worker" },
      { id: "visit:89", name: "Corrected", reconciliationState: "confirmed_off_site" },
      { id: "visit:90", name: "Departed", checkOutTime: "2026-10-28T12:00:00Z" },
    ]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    await screen.findByText("Field worker");
    expect(screen.queryByText("Corrected")).toBeNull();
    expect(screen.queryByText("Departed")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Check out:/ })).toBeNull();
  });
  it("defaults to All, filters recorded traffic, and shows incoming ETA runs separately", async () => {
    const onSite = {id:"visit:1",name:"In booth",checkInTime:new Date().toISOString()};
    const departed = {id:"visit:2",name:"Departed",checkInTime:new Date().toISOString(),checkOutTime:new Date().toISOString()};
    queryGateReportRows.mockImplementation(async (_kind, filters) => filters.recordType === "on_site" ? [onSite] : filters.recordType === "check_outs" ? [departed] : [onSite,departed]);
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><GateHistoryPage /></QueryClientProvider>);
    expect(screen.getByRole("button",{name:"All"}).getAttribute("aria-pressed")).toBe("true");
    await screen.findByText("In booth");
    expect(await screen.findByText("Incoming driver")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check out: In booth" }).className).toContain("gate-history-filter");
    fireEvent.click(screen.getByRole("button", { name: "View: Departed" }));
    expect(window.location.search).toContain("recordId=visit%3A2");
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button",{name:"On Site"}));
    await waitFor(()=>expect(queryGateReportRows).toHaveBeenLastCalledWith("history",expect.objectContaining({recordType:"on_site"})));
    await waitFor(()=>expect(screen.queryByText("Departed")).toBeNull());
    fireEvent.click(screen.getByRole("button",{name:"Departures"}));
    await screen.findByText("Departed");
    expect(queryGateReportRows).toHaveBeenLastCalledWith("history",expect.objectContaining({recordType:"check_outs"}));
    fireEvent.click(screen.getByRole("button",{name:"Arrivals"}));
    expect(await screen.findByText("Incoming driver")).toBeTruthy();
    expect(incoming).toHaveBeenCalledWith(42);
    expect(screen.queryByTestId("gate-history-row")).toBeNull();
    expect(screen.getByRole("combobox",{name:"Export"})).toBeTruthy();
    expect(screen.queryByTestId("button-gate-export-pdf")).toBeNull();
  });
  it("moves waiting-to-enter records to Arrivals and puts flags in the footer", async () => {
    const pending = { id: "visit:55", name: "Waiting truck", admissionStatus: "pending", checkInTime: "2026-10-28T08:00:00Z" };
    const present = { id: "visit:56", name: "Admitted truck", admissionStatus: "admitted", checkInTime: "2026-10-01T08:00:00Z", expectedMinutes: 1, checkInGpsEvidence: { status: "unavailable" } };
    queryGateReportRows.mockResolvedValue([pending, present]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateHistoryPage /></QueryClientProvider>);
    const flag = await screen.findByText("Location Flag: No GPS");
    expect(flag.closest(".gate-traffic-footer")).toBeTruthy();
    expect(flag.closest("button")).toBeNull();
    expect(screen.getByText(/Location Flag: Duration Time On Site \d+:\d{2} Overdue/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On Site" }));
    await waitFor(() => expect(screen.queryByText("Waiting truck")).toBeNull());
    expect(await screen.findByText("Admitted truck")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arrivals" }));
    expect(await screen.findByText("Waiting truck")).toBeTruthy();
    expect(screen.queryByText("Admitted truck")).toBeNull();
    expect(await screen.findByText("Incoming driver")).toBeTruthy();
  });
  it("requests historical site and station discovery for past gate reports", async () => {
    queryGateReportRows.mockResolvedValue([]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={cache}><GateHistoryPage /></QueryClientProvider>);
    await waitFor(() => expect(changeOverRequest).toHaveBeenCalledWith("/sites?mode=history"));
    await waitFor(() => expect(changeOverRequest).toHaveBeenCalledWith("/stations?siteId=42&mode=history"));
  });
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
    fireEvent.change(range, { target: { value: "7d" } });
    await waitFor(() => expect(queryGateReportRows).toHaveBeenLastCalledWith("history", expect.objectContaining({ range: "7d" })));
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
