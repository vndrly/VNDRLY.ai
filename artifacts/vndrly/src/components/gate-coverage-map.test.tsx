import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({ read: vi.fn(), points: [] as any[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, vendorId: 2, activeMembershipId: 3 } }) }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: mocks.read }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: (props: any) => { mocks.points = props.points; return <div>Map</div>; } }));
vi.mock("@/components/work-hub/chrome", () => ({ BrandedInput: (props: any) => <input {...props} /> }));
import { GateCoverageMap } from "./gate-coverage-map";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps stale staff off the map and exposes missing observations without an action", async () => {
  mocks.read.mockResolvedValue({ at: "2026-10-13T15:00:00Z", gates: [], duties: [], staff: [
    { userId: 4, name: "Fresh", fresh: true, assignment: "Gate A", locationReason: "current", location: { latitude: 31, longitude: -102, capturedAt: "2026-10-13T15:00:00Z" } },
    { userId: 5, name: "Stale", fresh: false, assignment: "Gate B", locationReason: "stale_or_inaccurate", location: { latitude: 32, longitude: -103, capturedAt: "2026-10-13T12:00:00Z" } },
    { userId: 6, name: "Missing", fresh: false, assignment: "Gate C", locationReason: "no_report", location: null },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Fresh");
  expect(mocks.points.map(point => point.id)).toEqual(["staff:4"]);
  expect(screen.getByText(/stale or inaccurate/)).toBeTruthy();
  expect(screen.getByText(/no report/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Coverage time/), { target: { value: "2026-10-12T10:00" } });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(expect.stringMatching(/^\/coverage-map\?at=/)));
  expect(mocks.read.mock.calls.every(call => call.length === 1)).toBe(true);
});
it("filters recorded gate duties, opens marker details, refreshes and expands the map", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], gates: [
    { id: "a", name: "North gate", siteName: "Site A", latitude: 31, longitude: -102 },
    { id: "b", name: "South gate", siteName: "Site A", latitude: 32, longitude: -103 },
  ], duties: [{ id: "d", stationId: "a", name: "Operator", startedAt: new Date().toISOString(), coverage: {} }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Live");
  expect(mocks.points.map(point => point.id)).toEqual(["gate:a", "gate:b"]);
  fireEvent.click(screen.getByRole("button", { name: "Staffed" }));
  expect(mocks.points.map(point => point.id)).toEqual(["gate:a"]);
  act(() => mocks.points[0].onClick());
  expect(screen.getByText("Site A · North gate")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "No recorded duty" }));
  expect(mocks.points.map(point => point.id)).toEqual(["gate:b"]);
  fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
  expect(screen.getByRole("button", { name: "Collapse map" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Expand map" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(1));
});
