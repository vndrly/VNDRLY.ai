import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: request }));
import { GateMapActivityPanel } from "./gate-map-activity-panel";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const gates = [{ id: "a", siteId: 1, siteName: "Site A" }, { id: "b", siteId: 2, siteName: "Site B" }, { id: "c", siteId: 1, siteName: "Site A" }];
const state = (id: string, siteId: number, count: number) => ({ site: { id: siteId, name: `Site ${siteId}` }, station: { id }, shift: { id: "watch" }, snapshot: {
  generatedAt: "2026-10-28T20:00:00Z", startedAt: "2026-10-28T08:00:00Z", revision: "revision", coverage: "known",
  metrics: { checkIns: count, checkOuts: 0, pendingAdmission: 0, onSiteVisitorRecords: count, onSiteEmployeeRecords: 0, onSiteVehicles: 0 },
  metricRecordIds: { checkIns: [`visit:${siteId}`] }, records: [{ id: `visit:${siteId}`, name: `Visitor ${siteId}`, company: "Vendor", kind: "visitor", checkIn: "2026-10-28T12:00:00Z", checkOut: null, plate: null, notes: null }], outstanding: [], exceptions: [], facts: [], openItems: [],
} });
function mount(selectedGateId: string | null) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateMapActivityPanel gates={gates} selectedGateId={selectedGateId} userId={1} membershipId={3} /></QueryClientProvider>); }
it("reuses the collapsible Dashboard card and scopes selected-site records and links", async () => {
  request.mockResolvedValue(state("a", 1, 4)); mount("a");
  const row = await screen.findByTestId("dashboard-metric-checkIns");
  await waitFor(() => expect(row.querySelector("summary small")?.textContent).toBe("4"));
  fireEvent.click(row.querySelector("summary")!);
  expect(within(row).getByRole("link", { name: /Visitor 1/ }).getAttribute("href")).toContain("siteId=1&stationId=a&range=current_shift");
  expect(screen.getByText(/Site A · Site records/)).toBeTruthy();
});
it("counts each authorized site once in All mode and preserves each record's correct site link", async () => {
  request.mockImplementation(async path => path === "/b/state" ? state("b", 2, 2) : state("c", 1, 4)); mount(null);
  const row = await screen.findByTestId("dashboard-metric-checkIns");
  await waitFor(() => expect(row.querySelector("summary small")?.textContent).toBe("6"));
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(row.querySelector("summary")!);
  expect(within(row).getByRole("link", { name: /Visitor 2/ }).getAttribute("href")).toContain("siteId=2&stationId=b");
});
it("shows unavailable instead of zero when the activity request fails", async () => {
  request.mockRejectedValue(new Error("Forbidden")); mount("a");
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByTestId("dashboard-metric-checkIns").querySelector("summary small")?.textContent).toBe("Unavailable");
});
