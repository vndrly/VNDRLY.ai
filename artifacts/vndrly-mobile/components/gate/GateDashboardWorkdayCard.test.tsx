import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, activeMembershipId: 2 }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/WorkdayControls", () => ({ default: ({ watchControl }: any) => watchControl }));
vi.mock("@/components/GateSiteGateSelect", () => ({ default: ({ sites }: any) => <div>{sites.map((site: any) => <span key={site.id}>{site.name}</span>)}</div> }));
import GateDashboardWorkdayCard from "./GateDashboardWorkdayCard";
afterEach(cleanup);
it("automatically recovers a site read cancelled during account hydration", async () => {
  request.mockRejectedValueOnce(Object.assign(new Error("Request authorization changed"), { name: "AbortError" }))
    .mockResolvedValueOnce({ sites: [{ id: 411, name: "Recovered gate site" }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0, retryDelay: 0 } } })}><GateDashboardWorkdayCard siteId={0} stationId="" gateName="" onSelection={() => {}} onShiftChange={() => {}} /></QueryClientProvider>);
  expect(await screen.findByText("Recovered gate site")).toBeTruthy();
  expect(screen.queryByText("Sites could not be loaded. Retry")).toBeNull();
});
it("shows a failed site read and loads gates when Retry succeeds", async () => {
  request.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { status: 503 }))
    .mockResolvedValueOnce({ sites: [{ id: 411, name: "Test gate site" }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })}><GateDashboardWorkdayCard siteId={0} stationId="" gateName="" onSelection={() => {}} onShiftChange={() => {}} /></QueryClientProvider>);
  expect(screen.getByText("Loading sites…")).toBeTruthy();
  fireEvent.click(await screen.findByText("Sites could not be loaded. Retry"));
  expect(await screen.findByText("Test gate site")).toBeTruthy();
  expect(screen.queryByText("Sites could not be loaded. Retry")).toBeNull();
});
