import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), geocode: vi.fn(), gps: vi.fn() }));
const user = vi.hoisted(() => ({ userId: 7, role: "vendor", vendorId: 2, activeMembershipId: 3, vendorRole: "office", availableMemberships: [{ id: 3, role: "member" }] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: mocks.request }));
vi.mock("@/lib/geocoding", () => ({ forwardGeocode: mocks.geocode }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => ({ "changeOver.site": "Site", "changeOver.newGate": "New gate name", "changeOver.addGate": "Add gate" } as Record<string,string>)[key] ?? key }) }));
import GateCreateCard from "./gate-create-card";
beforeEach(() => {
  vi.clearAllMocks();
  user.vendorRole = "office"; user.availableMemberships[0].role = "member";
  mocks.request.mockImplementation(async path => path === "/station-management/sites" ? { sites: user.vendorRole === "gatekeeper" && user.availableMemberships[0].role !== "admin" ? [] : [{ id: 10, name: "Site A" }, { id: 20, name: "Site B" }] } : { id: "new-gate" });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: mocks.gps } });
});
async function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><GateCreateCard /></QueryClientProvider>);
  await screen.findByRole("form", { name: "Add gate" });
  fireEvent.change(screen.getByLabelText("New gate name"), { target: { value: "West gate" } });
}
it("requires an actual location and does not request GPS on page load", async () => {
  await mount();
  expect((screen.getByRole("button", { name: "Add gate" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.gps).not.toHaveBeenCalled();
});
it("uses server-authorized management sites and hides administration from gatekeepers", async () => {
  user.vendorRole = "gatekeeper";
  render(<QueryClientProvider client={new QueryClient()}><GateCreateCard /></QueryClientProvider>);
  expect(screen.queryByText("Administrative functions")).toBeNull();
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/station-management/sites"));
  expect(screen.queryByRole("form", { name: "Add gate" })).toBeNull();
});
it("keeps administrators visible even when their employee role is gatekeeper", async () => {
  user.vendorRole = "gatekeeper"; user.availableMemberships[0].role = "admin";
  await mount();
  expect(screen.getByRole("combobox", { name: "Administrative function" })).toBeTruthy();
});
it("prefills an existing gate and saves its location with its current version", async () => {
  const gate = { id: "gate-west", siteId: 10, name: "West gate", latitude: 35.1, longitude: -97.2, version: 4 };
  mocks.request.mockImplementation(async (path, body) => {
    if (path === "/station-management/sites") return { sites: [{ id: 10, name: "Site A" }, { id: 20, name: "Site B" }] };
    if (path.startsWith("/station-management/stations")) return { stations: [gate] };
    return { ...gate, latitude: body.location.latitude, version: 5 };
  });
  await mount();
  const modes = screen.getByRole("combobox", { name: "Administrative function" });
  expect([...modes.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Create Gate", "Move a Gate", "Edit a Gate"]);
  fireEvent.change(modes, { target: { value: "edit" } });
  await screen.findByRole("option", { name: "West gate" });
  fireEvent.change(screen.getByLabelText("Choose a gate"), { target: { value: "gate-west" } });
  expect((screen.getByLabelText("Gate name") as HTMLInputElement).value).toBe("West gate");
  expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("35.1");
  expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("-97.2");
  const save = screen.getByRole("button", { name: "Save Gate Changes" });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "35.4" } });
  fireEvent.click(save);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/stations/gate-west/location", { siteId: 10, name: "West gate", location: { latitude: 35.4, longitude: -97.2 }, expectedVersion: 4, operationId: expect.any(String) }));
  expect(await screen.findByText("Gate location saved.")).toBeTruthy();
  expect((save as HTMLButtonElement).disabled).toBe(true);
});
it("uses Move a Gate for location changes with the existing gate name read-only", async () => {
  mocks.request.mockImplementation(async path => path === "/station-management/sites" ? { sites: [{ id: 10, name: "Site A" }] } : { stations: [{ id: "gate-west", siteId: 10, name: "West gate", latitude: 35.1, longitude: -97.2, version: 4 }] });
  await mount();
  fireEvent.change(screen.getByLabelText("Administrative function"), { target: { value: "move" } });
  await screen.findByRole("option", { name: "West gate" });
  fireEvent.change(screen.getByLabelText("Choose a gate"), { target: { value: "gate-west" } });
  expect((screen.getByLabelText("Gate name") as HTMLInputElement).readOnly).toBe(true);
  expect(screen.getByRole("button", { name: "Save Moved Gate Locations" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove Gate" })).toBeNull();
});
it("removes an existing gate without requiring invented coordinates", async () => {
  let removed = false;
  mocks.request.mockImplementation(async path => {
    if (path === "/station-management/sites") return { sites: [{ id: 10, name: "Site A" }] };
    if (path.endsWith("/retire")) { removed = true; return { active: false }; }
    return { stations: removed ? [] : [{ id: "gate-west", siteId: 10, name: "West gate", latitude: null, longitude: null, version: 4 }] };
  });
  await mount();
  fireEvent.change(screen.getByLabelText("Administrative function"), { target: { value: "edit" } });
  await screen.findByRole("option", { name: "West gate" });
  fireEvent.change(screen.getByLabelText("Choose a gate"), { target: { value: "gate-west" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove Gate" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/stations/gate-west/retire", { siteId: 10, expectedVersion: 4, operationId: expect.any(String) }));
  expect(await screen.findByText("Gate removed from active use. Its history is retained.")).toBeTruthy();
});
it("saves manually entered coordinates as numbers for the selected site", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("Set location by"), { target: { value: "coordinates" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "35.12" } });
  expect((screen.getByRole("button", { name: "Add gate" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-97.25" } });
  fireEvent.click(screen.getByRole("button", { name: "Add gate" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/stations", { siteId: 10, name: "West gate", location: { latitude: 35.12, longitude: -97.25 } }));
  expect(await screen.findByText("Gate created: West gate")).toBeTruthy();
});
it("uses device GPS only after the user asks and sends the captured coordinates", async () => {
  mocks.gps.mockImplementation(success => success({ coords: { latitude: 35.7, longitude: -97.8 } }));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
  expect(screen.getByText("35.700000, -97.800000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add gate" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/stations", expect.objectContaining({ location: { latitude: 35.7, longitude: -97.8 } })));
});
it("converts an address to coordinates before allowing creation", async () => {
  mocks.geocode.mockResolvedValue({ latitude: 35.4, longitude: -97.5, displayName: "Resolved gate address" });
  await mount();
  fireEvent.change(screen.getByLabelText("Set location by"), { target: { value: "address" } });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Access Road, Oklahoma City" } });
  fireEvent.click(screen.getByRole("button", { name: "Find Location" }));
  expect(await screen.findByText("Resolved gate address")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add gate" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/stations", expect.objectContaining({ location: { latitude: 35.4, longitude: -97.5 } })));
});
it("does not save failed address lookups as zero coordinates", async () => {
  mocks.geocode.mockResolvedValue(null);
  await mount();
  fireEvent.change(screen.getByLabelText("Set location by"), { target: { value: "address" } });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Unresolved address" } });
  fireEvent.click(screen.getByRole("button", { name: "Find Location" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Address not found");
  expect((screen.getByRole("button", { name: "Add gate" }) as HTMLButtonElement).disabled).toBe(true);
});
it("discards a delayed address lookup after the site changes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.geocode.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount();
  fireEvent.change(screen.getByLabelText("Set location by"), { target: { value: "address" } });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Old site address" } });
  fireEvent.click(screen.getByRole("button", { name: "Find Location" }));
  fireEvent.change(screen.getByLabelText("Site"), { target: { value: "20" } });
  await act(async () => resolve({ latitude: 35, longitude: -97, displayName: "Old site address" }));
  expect(screen.queryByText("Gate coordinates")).toBeNull();
  expect((screen.getByRole("button", { name: "Add gate" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows administration to a supervisor authorized by the server even when the legacy role is gatekeeper", async () => {
  user.vendorRole = "gatekeeper";
  mocks.request.mockResolvedValue({ sites: [{ id: 10, name: "Site A" }] });
  await mount();
  expect(screen.getByRole("combobox", { name: "Administrative function" })).toBeTruthy();
});
