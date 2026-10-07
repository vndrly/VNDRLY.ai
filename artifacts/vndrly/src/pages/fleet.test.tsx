import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  overviewPage: vi.fn(),
  run: vi.fn(),
  gateObservations: vi.fn(),
  reviewPacket: vi.fn(),
  location: "/fleet/my-day",
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
  useLocation: () => [api.location],
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
  api.location = "/fleet/my-day";
  api.overviewPage.mockResolvedValue({
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
  it("shows only own completed or cancelled loaded runs in recorded history", async () => {
    api.location = "/fleet/history";
    const initial = await api.overviewPage();
    api.overviewPage.mockResolvedValue({
      ...initial,
      runs: [
        run,
        { ...run, id: "done", title: "Own completed", status: "completed" },
        {
          ...run,
          id: "other-done",
          title: "Other completed",
          driverUserId: 8,
          status: "completed",
        },
      ],
    });
    mount();
    await screen.findByText("Own completed");
    expect(screen.queryByText("Own pickup")).toBeNull();
    expect(screen.queryByText("Other completed")).toBeNull();
  });
  it("clears previously loaded runs when a later page reports their fleet grant revoked", async () => {
    const initial = await api.overviewPage();
    api.overviewPage
      .mockResolvedValueOnce({
        ...initial,
        page: { limit: 1, nextCursor: "next" },
      })
      .mockResolvedValueOnce({
        ...initial,
        fleets: [],
        runs: [],
        page: { limit: 1, nextCursor: null },
      });
    mount();
    await screen.findByText("Own pickup");
    fireEvent.click(screen.getByText("Load more authorized runs"));
    await screen.findByText("No runs are currently assigned to you.");
    expect(screen.queryByText("Own pickup")).toBeNull();
  });
  it("loads a current authorized run detail even beyond the overview page", async () => {
    api.location = "/fleet/runs/historical";
    api.run.mockResolvedValueOnce({
      ...run,
      id: "historical",
      title: "Historical pickup",
    });
    mount();
    await screen.findAllByText("Historical pickup");
    expect(api.run).toHaveBeenCalledWith("historical");
    expect(screen.getByText("Acknowledge assignment")).toBeTruthy();
  });
  it("loads the server cursor without losing already loaded authorized runs", async () => {
    const initial = await api.overviewPage();
    api.overviewPage
      .mockResolvedValueOnce({
        ...initial,
        runs: [run],
        page: { limit: 1, nextCursor: "next-authorized-page" },
      })
      .mockResolvedValueOnce({
        ...initial,
        runs: [{ ...run, id: "run2", title: "Second pickup" }],
        page: { limit: 1, nextCursor: null },
      });
    mount();
    fireEvent.click(await screen.findByText("Load more authorized runs"));
    await screen.findByText("Second pickup");
    expect(api.overviewPage).toHaveBeenCalledWith("next-authorized-page");
    expect(screen.getByText("Own pickup")).toBeTruthy();
  });
  it("keeps generated run and stop identities on exact create retry", async () => {
    const fleetId = "22222222-2222-4222-8222-222222222222";
    const assetId = "33333333-3333-4333-8333-333333333333";
    api.overviewPage.mockResolvedValueOnce({
      companyId: 1,
      enabled: true,
      capabilities: { canDrive: true, canDispatch: true, canManage: true },
      fleets: [
        {
          id: fleetId,
          name: "North fleet",
          siteIds: [10, 20],
          equipmentAssetIds: [assetId],
        },
      ],
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
    api.overviewPage.mockResolvedValueOnce({
      companyId: 1,
      enabled: true,
      capabilities: { canDrive: true },
      fleets: [{ id: "fleet1", name: "Fleet one", siteIds: [10] }],
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

it("blocks closeout review until current required saved files are present", async () => {
  api.location = "/fleet/runs/run1";
  api.run.mockResolvedValue({
    ...run,
    status: "in_progress",
    allowedActions: ["submit_closeout"],
  });
  api.reviewPacket.mockResolvedValue({
    runId: run.id,
    runVersion: run.version,
    missingRequiredCount: 1,
    inspectionExceptions: 0,
    undeliveredLoadCount: 0,
    requirements: [],
  });
  mount();
  const button = await screen.findByRole("button", { name: "submit closeout" });
  fireEvent.click(button);
  await screen.findAllByText(
    "Recorded requirements are incomplete. Save missing files and complete the inspection, manifests and closeout records before review.",
  );
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.queryByText(/Review change submit_closeout/)).toBeNull();
});
