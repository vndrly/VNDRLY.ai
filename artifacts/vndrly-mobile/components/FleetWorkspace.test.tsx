import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), membership: 1 }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/fleet-offline-native", () => ({ nativeFleetOffline: { read: async () => ({ actions: [] }), cache: async () => {}, resolve: async () => {}, enqueue: async () => {} } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, activeMembershipId: mocks.membership }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: ({ title }: any) => <h1>{title}</h1> }));
vi.mock("@/components/MapboxNativeMap", () => ({ default: () => <div>Fleet location map</div> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetWorkspace from "./FleetWorkspace";
const overview = { companyId: 609, enabled: true, roles: ["driver"], capabilities: { canDispatch: false, canManage: false, canDrive: true }, fleets: [], runs: [], observations: [], unavailableIntegrations: [], generatedAt: "2026-10-07T12:00:00Z" };
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.membership = 1; });
describe("mobile Fleet authorization", () => {
  it("saves own acknowledgement using server revision and renders the saved next step without claiming completion", async () => {
    const run = { id: "20000000-0000-4000-8000-000000000001", title: "Synthetic load", version: 4, driverUserId: 1, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, status: "dispatched", allowedActions: ["acknowledge"], currentStopId: null, loads: [], inspections: [], records: [], events: [], stops: [] };
    let accepted = false;
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/actions")) { accepted = true; return { ...run, status: "acknowledged", version: 5 }; }
      return { ...overview, runs: [{ ...run, status: accepted ? "acknowledged" : "dispatched", version: accepted ? 5 : 4, allowedActions: accepted ? ["inspect"] : ["acknowledge"] }] };
    });
    render(<FleetWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Synthetic load · dispatched" }));
    fireEvent.click(screen.getByRole("button", { name: "acknowledge" }));
    expect(await screen.findByRole("button", { name: "Synthetic load · acknowledged" })).toBeTruthy();
    const request = mocks.api.mock.calls.find(call => call[0].endsWith("/actions"));
    expect(JSON.parse(request![1].body)).toMatchObject({ expectedVersion: 4, action: "acknowledge", operationId: "10000000-0000-4000-8000-000000000001", source: "user_report" });
    expect(screen.queryByText(/completed/)).toBeNull();
  });
  it("loads driver work without dispatcher roster and labels absent telemetry", async () => {
    mocks.api.mockResolvedValue(overview);
    render(<FleetWorkspace />);
    expect(await screen.findByText("My Fleet Day")).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/api/fleet/overview");
    expect(screen.getByText(/No sourced Fleet location/)).toBeTruthy();
    expect(screen.queryByText("Create draft run")).toBeNull();
  });
  it("clears old company records immediately when active membership changes", async () => {
    mocks.api.mockResolvedValueOnce(overview).mockImplementation(() => new Promise(() => {}));
    const view = render(<FleetWorkspace />);
    await screen.findByText("My Fleet Day");
    mocks.membership = 2;
    view.rerender(<FleetWorkspace />);
    expect(screen.queryByText("Active company: 609")).toBeNull();
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });
});
