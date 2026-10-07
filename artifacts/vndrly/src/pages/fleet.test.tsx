import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  overview: vi.fn(),
  resources: vi.fn(),
  action: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({
  fleetClient: api,
  fleetErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 7, vendorId: 1, activeMembershipId: 2 } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/fleet/my-day"],
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("@/components/mapbox-map", () => ({
  MapboxMap: () => <div>Recorded map</div>,
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
import FleetPage from "./fleet";
const run = {
  id: "run1",
  companyId: 1,
  fleetId: "fleet1",
  title: "Own pickup",
  driverUserId: 7,
  vehicleAssetId: "asset1",
  siteIds: [10],
  status: "dispatched",
  version: 2,
  stops: [{ id: "stop", siteId: 10, kind: "pickup", sequence: 0 }],
  loads: [],
  records: [],
  currentStopId: null,
  visitedStopIds: [],
  inspections: [],
  events: [],
  allowedActions: ["acknowledge"],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.overview.mockResolvedValue({
    companyId: 1,
    enabled: true,
    roles: ["driver"],
    capabilities: { canDrive: true, canDispatch: false, canManage: false },
    fleets: [{ id: "fleet1", name: "Fleet one", siteIds: [10] }],
    runs: [
      run,
      { ...run, id: "other", title: "Other driver", driverUserId: 8 },
    ],
    observations: [],
    unavailableIntegrations: ["hardware_positions"],
    generatedAt: "2026-10-07T00:00:00Z",
  });
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetPage />
    </QueryClientProvider>,
  );
describe("Fleet driver workspace", () => {
  it("keeps generated run and stop identities on exact create retry", async () => {
    const fleetId = "22222222-2222-4222-8222-222222222222";
    const assetId = "33333333-3333-4333-8333-333333333333";
    api.overview.mockResolvedValueOnce({
      companyId: 1,
      enabled: true,
      capabilities: { canDrive: true, canDispatch: true, canManage: true },
      fleets: [{ id: fleetId, name: "North fleet", siteIds: [10, 20] }],
      runs: [],
      observations: [],
      unavailableIntegrations: [],
      generatedAt: "now",
    });
    api.resources.mockResolvedValueOnce({
      drivers: [{ userId: 7, name: "Driver seven", fleetIds: [fleetId] }],
      equipment: [
        {
          id: assetId,
          name: "Truck seven",
          category: "truck",
          dispatchable: true,
        },
      ],
    });
    api.create
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({});
    mount();
    fireEvent.click(await screen.findByText("Create run"));
    fireEvent.change(screen.getByLabelText("Fleet"), {
      target: { value: fleetId },
    });
    await screen.findByText("Driver seven");
    fireEvent.change(screen.getByLabelText("Run title"), {
      target: { value: "Water delivery" },
    });
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Vehicle"), {
      target: { value: assetId },
    });
    fireEvent.change(screen.getByLabelText("Pickup site"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Delivery site"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByText("Save exact change"));
    await screen.findByText(/record changed or this action is blocked/);
    fireEvent.click(screen.getByText("Save exact change"));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[0][0]).toEqual(api.create.mock.calls[1][0]);
  });
  it("shows only assigned runs with an honest unavailable map and no dispatch creation", async () => {
    mount();
    await screen.findByText("Own pickup");
    expect(screen.queryByText("Other driver")).toBeNull();
    expect(screen.queryByText("Create run")).toBeNull();
    expect(screen.getByText(/No authorized recorded positions/)).toBeTruthy();
    expect(api.resources).not.toHaveBeenCalled();
  });
  it("requires exact review, keeps retry identity after an uncertain response, and sends server version", async () => {
    api.action
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ ...run, version: 3 });
    mount();
    fireEvent.click(await screen.findByText("Own pickup"));
    fireEvent.click(screen.getByText("Acknowledge assignment"));
    expect(api.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save exact change"));
    await screen.findByText(/record changed or this action is blocked/);
    fireEvent.click(screen.getByText("Save exact change"));
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2));
    expect(api.action.mock.calls[0]).toEqual(api.action.mock.calls[1]);
    expect(api.action.mock.calls[0][1]).toMatchObject({
      expectedVersion: 2,
      action: "acknowledge",
    });
  });
  it("does not advertise blocked or absent run actions", async () => {
    api.overview.mockResolvedValueOnce({
      companyId: 1,
      enabled: true,
      capabilities: { canDrive: true },
      fleets: [],
      runs: [{ ...run, allowedActions: [] }],
      observations: [],
      unavailableIntegrations: [],
      generatedAt: "now",
    });
    mount();
    fireEvent.click(await screen.findByText("Own pickup"));
    expect(screen.queryByText("Acknowledge assignment")).toBeNull();
    expect(api.action).not.toHaveBeenCalled();
  });
});
