import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({ read: vi.fn(), points: [] as any[], mapProps: {} as any }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, vendorId: 2, activeMembershipId: 3 } }) }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: mocks.read }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: (props: any) => { mocks.points = props.points; mocks.mapProps = props; return <div>Map</div>; } }));
vi.mock("@/components/work-hub/chrome", () => ({ BrandedInput: (props: any) => <input {...props} />, BrandedSelect: (props: any) => <select {...props} /> }));
import { GateCoverageMap } from "./gate-coverage-map";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("uses the viewing selector to focus one gate without creating or editing a gate", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], gates: [
    { id: "a", siteId: 1, name: "North gate", siteName: "Site A", latitude: 31, longitude: -102 },
    { id: "b", siteId: 1, name: "South gate", siteName: "Site A", latitude: 32, longitude: -103 },
    { id: "c", siteId: 2, name: "Main gate", siteName: "Site B", siteLatitude: 33, siteLongitude: -104 },
  ], duties: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap showGateSelector /></QueryClientProvider>);
  const selector = await screen.findByTestId("select-gate-map-location");
  expect(screen.getByRole("option", { name: "Site A | South gate" })).toBeTruthy();
  fireEvent.change(selector, { target: { value: "b" } });
  expect(mocks.mapProps).toMatchObject({ selectedPointId: "gate:b", center: [-103, 32], zoom: 16, fitToData: false });
  expect(screen.queryByText("Select a gate on the map")).toBeNull();
  fireEvent.change(selector, { target: { value: "c" } });
  expect(mocks.mapProps.center).toEqual([-104, 33]);
  fireEvent.change(selector, { target: { value: "" } });
  expect(mocks.mapProps.fitToData).toBe(true);
  expect(mocks.mapProps.selectedPointId).toBeNull();
  expect(mocks.read.mock.calls.every(call => call.length === 1 && call[0] === "/coverage-map")).toBe(true);
});
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
it("groups all app employees, sorts names, and pans to a selected current staff location", async () => {
  const location = { latitude: 31, longitude: -102, capturedAt: new Date().toISOString() };
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), gates: [], duties: [], staff: [
    { userId: 8, name: "Zoe", onWatch: true, onCall: true, fresh: true, assignment: "Site A | Main Gate", locationReason: "current", location },
    { userId: 9, name: "Ben", onCall: true, fresh: true, assignment: "On call", locationReason: "current", location: { ...location, latitude: 32 } },
    { userId: 10, name: "Zach", fresh: true, assignment: "Field ticket", locationReason: "current", location },
    { userId: 11, name: "Amy", fresh: true, assignment: "Field ticket", locationReason: "current", location },
    { userId: 12, name: "Unavailable", fresh: false, assignment: "None", locationReason: "sharing_off", location: null },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  const watch = (await screen.findByText("On Watch")).closest("details")!;
  expect(watch.querySelector("strong")?.textContent).toBe("Zoe");
  const others = screen.getByText("Everyone else").closest("details")!;
  fireEvent.click(others.querySelector("summary")!);
  expect([...others.querySelectorAll("strong")].map(row => row.textContent)).toEqual(["Amy", "Unavailable", "Zach"]);
  fireEvent.click(screen.getByRole("button", { name: /^Amy/ }));
  expect(mocks.mapProps).toMatchObject({ selectedPointId: "staff:11", center: [-102, 31], panToSelectedPoint: true, fitToData: false });
  expect((screen.getByRole("button", { name: /^Unavailable/ }) as HTMLButtonElement).disabled).toBe(true);
});
it("adds tracked vehicle hover details without treating routing failure as zero speed or ETA", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), gates: [], duties: [], staff: [], vehicles: [
    { runId: "run", latitude: 31, longitude: -102, vehicleLabel: "Truck 24", driverName: "Driver", title: "Water haul", companyName: "Hauler", ticketNumber: "T24", destinationName: "Site A", originName: "Yard", speedMph: null, etaMinutes: null, accuracyMeters: 8, headingDegrees: 90, observedAt: new Date().toISOString() },
  ] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Staff locations");
  expect(mocks.points[0]).toMatchObject({ id: "vehicle:run", popupOnHover: true, popupClassName: "gate-map-vehicle-popup" });
  expect(mocks.points[0].popupHtml).toContain("Yard");
  expect(mocks.points[0].popupHtml).toContain("Not available");
});
it("uses mini-card map toggles without coverage filters and preserves refresh and expand", async () => {
  mocks.read.mockResolvedValue({ at: new Date().toISOString(), staff: [], gates: [
    { id: "a", name: "North gate", siteName: "Site A", latitude: 31, longitude: -102 },
    { id: "b", name: "South gate", siteName: "Site A", latitude: 32, longitude: -103 },
  ], duties: [{ id: "d", stationId: "a", name: "Operator", startedAt: new Date().toISOString(), coverage: {} }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateCoverageMap /></QueryClientProvider>);
  await screen.findByText("Live");
  expect(mocks.points.map(point => point.id)).toEqual(["gate:a", "gate:b"]);
  expect(screen.queryByRole("button", { name: "Staffed" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^All$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "No recorded duty" })).toBeNull();
  const street = screen.getByRole("button", { name: "Street" });
  expect(street.className).toContain("gate-history-filter");
  expect(street.querySelector("svg")).toBeTruthy();
  fireEvent.click(street);
  expect(mocks.mapProps.styleKind).toBe("street");
  expect(street.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Satellite" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: /^Fit$/ }).closest(".gate-map-view-controls")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
  expect(screen.getByRole("button", { name: "Collapse map" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Expand map" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(1));
});
