import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { summarizeGpsDistance } from "@workspace/map-utils";
import { CrewInspector } from "./crew-inspector";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows selected-ticket distance only and does not request an ETA from a future GPS fix", async () => {
  const recordedAt = new Date(Date.now() + 3600_000).toISOString();
  const pings = [
    { ticketId: 1, latitude: 35, longitude: -97, recordedAt: "2026-09-07T12:00:00Z" },
    { ticketId: 1, latitude: 35.01, longitude: -97, recordedAt: "2026-09-07T12:05:00Z" },
    { ticketId: 2, latitude: 35, longitude: -97, recordedAt: "2026-09-07T13:00:00Z" },
    { ticketId: 2, latitude: 35.1, longitude: -97, recordedAt: "2026-09-07T13:05:00Z" },
  ];
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("day-track") ? { pings } : { trips: [{ ticketId: 1, employeeId: 2, enRouteAt: "invalid", checkInTime: null }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><CrewInspector scope="vendor:4" point={{ employeeId: 2, employeeName: "Crew Member", ticketId: 1, lifecycleState: "en_route", latitude: 35, longitude: -97, siteLatitude: 36, siteLongitude: -97, siteName: "Site", recordedAt }} /></QueryClientProvider>);
  const miles = (summarizeGpsDistance(pings.slice(0, 2)).meters / 1609.344).toFixed(1);
  expect(await screen.findByText(`${miles} mi`)).toBeTruthy();
  const dailyMiles = (summarizeGpsDistance(pings).meters / 1609.344).toFixed(1);
  expect(screen.getByText(`${dailyMiles} mi`)).toBeTruthy();
  expect(screen.queryByText(/NaN/)).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => !url.includes("mapbox.com"))).toBe(true);
  for (const query of client.getQueryCache().getAll().filter((query) => !String(query.queryKey[0]).endsWith("route"))) {
    expect(query.getObserversCount()).toBe(1);
    expect(query.queryKey).toContain("vendor:4");
  }
  client.clear();
});
