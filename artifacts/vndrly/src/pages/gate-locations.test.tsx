import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/content-pane-back-link", () => ({ default: () => <a href="/">Back</a> }));
vi.mock("@/components/gate-coverage-map", () => ({ GateCoverageMap: () => <section aria-label="Gate coverage map">Coverage map</section> }));
vi.mock("@/components/mapbox-map", () => ({ MapboxMap: () => <div aria-label="Gate position map">Map</div> }));
import GateLocationsPage from "./gate-locations";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/sites")) return { ok: true, json: async () => ({ sites: [{ id: 7, name: "North Yard" }] }) };
    if (url.includes("?siteId=7")) return { ok: true, json: async () => ({ gates: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", siteId: 7, name: "Main Gate", latitude: 35.1, longitude: -97.2, geofenceRadiusM: 500, active: true, version: 2 }] }) };
    if (url.endsWith("/preview")) return { ok: true, json: async () => ({ values: JSON.parse(String(init?.body)), confirmation: "review-token" }) };
    return { ok: true, json: async () => ({ id: "saved" }) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><GateLocationsPage /></QueryClientProvider>);
}

it("shows gate setup above the live monitoring map and uses review before save", async () => {
  mount();
  expect(await screen.findByText("Main Gate")).not.toBeNull();
  expect(screen.getByRole("region", { name: "Gate coverage map" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Add Gate Location/ }));
  fireEvent.change(screen.getByLabelText("Gate name"), { target: { value: "West Gate" } });
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "35.2" } });
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-97.3" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Gate Location" }));
  expect(await screen.findByText(/Confirm:/)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("/api/gate-locations/preview", expect.objectContaining({ method: "POST" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/gate-locations", expect.objectContaining({ method: "POST" })));
});
