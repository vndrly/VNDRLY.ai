import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  membership: 1,
  actions: [] as any[],
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/lib/fleet-offline-native", () => ({
  nativeFleetOffline: {
    read: async () => ({ actions: mocks.actions }),
    cache: async () => {},
    resolve: async () => {},
    enqueue: async () => {},
  },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: 1, vendorId: 609 },
    activeMembershipId: mocks.membership,
  }),
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "black", border: "gray", destructive: "red" }),
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000001",
}));
vi.mock("@/components/ScreenSafeArea", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/WorkHubPageTitle", () => ({
  default: ({ title }: any) => <h1>{title}</h1>,
}));
vi.mock("@/components/MapboxNativeMap", () => ({
  default: () => <div>Fleet location map</div>,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
import FleetWorkspace from "./FleetWorkspace";
const overview = {
  companyId: 609,
  enabled: true,
  roles: ["driver"],
  capabilities: { canDispatch: false, canManage: false, canDrive: true },
  fleets: [],
  runs: [],
  observations: [],
  unavailableIntegrations: [],
  generatedAt: "2026-10-07T12:00:00Z",
};
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
  mocks.membership = 1;
  mocks.actions = [];
});
describe("mobile Fleet authorization", () => {
  it("opens Origins and Destinations as its own scoped page", async () => {
    mocks.api.mockResolvedValue({
      version: 1,
      destinations: [],
      canManage: false,
      defaultMode: "batch",
      sitePolicy: null,
      sites: [],
    });
    render(<FleetWorkspace initialMode="locations" />);
    expect(
      await screen.findByRole("heading", { name: "Origins and Destinations" }),
    ).toBeTruthy();
    expect(
      mocks.api.mock.calls.some((call) => call[0] === "/api/fleet/resources"),
    ).toBe(false);
  });
  it("loads paginated Fleet Inventory independently of the capped dispatcher resources endpoint", async () => {
    const assetId = "30000000-0000-4000-8000-000000000001";
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/fleet/resources")
        throw Object.assign(new Error("Resource cap exceeded"), {
          status: 409,
        });
      if (path === "/api/fleet/inventory")
        return {
          canManage: false,
          version: 1,
          fleets: [],
          nextCursor: null,
          assets: [
            {
              id: assetId,
              name: "Canonical paginated truck",
              category: "truck",
              status: "available",
              version: 1,
              manufacturer: "",
              model: "",
              legalOwner: "Synthetic owner",
              aliases: [],
              held: false,
              currentHolderUserId: null,
              fleetIds: [],
            },
          ],
        };
      return {
        ...overview,
        capabilities: { canDispatch: true, canManage: true, canDrive: false },
      };
    });
    render(<FleetWorkspace initialMode="inventory" />);
    expect(await screen.findByText("Canonical paginated truck")).toBeTruthy();
    expect(
      mocks.api.mock.calls.some((call) => call[0] === "/api/fleet/resources"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Add Fleet Asset" }),
    ).toBeNull();
  });
  it("saves own acknowledgement using server revision and renders the saved next step without claiming completion", async () => {
    const run = {
      id: "20000000-0000-4000-8000-000000000001",
      title: "Synthetic load",
      version: 4,
      driverUserId: 1,
      vehicleAssetId: "30000000-0000-4000-8000-000000000001",
      trailerAssetId: null,
      status: "dispatched",
      allowedActions: ["acknowledge"],
      currentStopId: null,
      loads: [],
      inspections: [],
      records: [],
      events: [],
      stops: [],
    };
    let accepted = false;
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/actions")) {
        accepted = true;
        return { ...run, status: "acknowledged", version: 5 };
      }
      return {
        ...overview,
        runs: [
          {
            ...run,
            status: accepted ? "acknowledged" : "dispatched",
            version: accepted ? 5 : 4,
            allowedActions: accepted ? ["inspect"] : ["acknowledge"],
          },
        ],
      };
    });
    render(<FleetWorkspace initialRunId={run.id} />);
    await screen.findByText("Synthetic load");
    fireEvent.click(screen.getByRole("button", { name: "acknowledge" }));
    expect(await screen.findByRole("button", { name: "inspect" })).toBeTruthy();
    const request = mocks.api.mock.calls.find((call) =>
      call[0].endsWith("/actions"),
    );
    expect(JSON.parse(request![1].body)).toMatchObject({
      expectedVersion: 4,
      action: "acknowledge",
      operationId: "10000000-0000-4000-8000-000000000001",
      source: "user_report",
    });
    expect(screen.queryByText(/completed/)).toBeNull();
  });
  it("loads driver work without dispatcher roster and labels absent telemetry", async () => {
    mocks.api.mockResolvedValue({
      ...overview,
      unavailableIntegrations: ["vehicle_hardware", "camera_playback"],
    });
    render(<FleetWorkspace />);
    expect(await screen.findByText("My Fleet Day")).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/api/fleet/overview");
    expect(screen.getByText("No run assigned")).toBeTruthy();
    expect(screen.queryByText(/No sourced Fleet location/)).toBeNull();
    expect(screen.queryByText("Create draft run")).toBeNull();
    expect(screen.queryByText(/vehicle_hardware|camera_playback/)).toBeNull();
    expect(screen.queryByText(/trackers, camera feeds/)).toBeNull();
  });
  it("clears old company records immediately when active membership changes", async () => {
    mocks.api
      .mockResolvedValueOnce(overview)
      .mockImplementation(() => new Promise(() => {}));
    const view = render(<FleetWorkspace />);
    await screen.findByText("My Fleet Day");
    mocks.membership = 2;
    view.rerender(<FleetWorkspace />);
    expect(screen.queryByText("Active company: 609")).toBeNull();
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });
});

it("keeps canonical loads separate while proposed queued load enables the next ordered step", async () => {
  const id = "20000000-0000-4000-8000-000000000001",
    pickup = "40000000-0000-4000-8000-000000000001",
    delivery = "40000000-0000-4000-8000-000000000002";
  const run = {
    id,
    companyId: 609,
    title: "Offline hauling",
    version: 7,
    driverUserId: 1,
    vehicleAssetId: "30000000-0000-4000-8000-000000000001",
    trailerAssetId: null,
    status: "in_progress",
    phase: "traveling_to_pickup",
    allowedActions: ["arrive_stop"],
    currentStopId: null,
    visitedStopIds: [],
    loads: [],
    inspections: [],
    records: [],
    events: [],
    siteIds: [392],
    stops: [
      { id: pickup, siteId: 392, sequence: 0, kind: "pickup" },
      { id: delivery, siteId: 392, sequence: 1, kind: "delivery" },
    ],
  };
  const base = {
    runId: id,
    companyId: 609,
    driverUserId: 1,
    vehicleAssetId: run.vehicleAssetId,
    trailerAssetId: null,
    version: 7,
  };
  mocks.actions = [
    {
      base,
      runId: id,
      state: "unsynced",
      capturedAt: "2026-10-07T12:00:00Z",
      input: {
        action: "arrive_stop",
        expectedVersion: 7,
        operationId: "10000000-0000-4000-8000-000000000001",
        stopId: pickup,
      },
    },
    {
      base,
      runId: id,
      state: "unsynced",
      capturedAt: "2026-10-07T12:01:00Z",
      input: {
        action: "record_load",
        expectedVersion: 8,
        operationId: "10000000-0000-4000-8000-000000000002",
        loadId: "50000000-0000-4000-8000-000000000001",
        commodity: "Synthetic sand",
        quantity: 5,
        unit: "tons",
        manifestReference: "SYN-1",
      },
    },
  ];
  mocks.api.mockResolvedValue({ ...overview, runs: [run] });
  render(<FleetWorkspace initialRunId={id} />);
  expect(
    await screen.findByText(
      /Pending device sequence, not accepted by the server/,
    ),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "depart stop" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(screen.queryByText(/Synthetic sand:/)).toBeNull();
  expect(mocks.api.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
    false,
  );
});

it("loads an exact authorized device run outside the first overview page", async () => {
  const id = "20000000-0000-4000-8000-000000000010";
  const run = {
    id,
    companyId: 609,
    title: "Historical authorized run",
    version: 9,
    driverUserId: 1,
    vehicleAssetId: "30000000-0000-4000-8000-000000000001",
    trailerAssetId: null,
    status: "completed",
    allowedActions: [],
    currentStopId: null,
    visitedStopIds: [],
    loads: [],
    inspections: [],
    records: [],
    events: [],
    stops: [],
    siteIds: [],
  };
  mocks.api.mockImplementation(async (path) =>
    path === `/api/fleet/runs/${id}` ? run : overview,
  );
  render(<FleetWorkspace initialRunId={id} />);
  expect(await screen.findByText("Historical authorized run")).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledWith(`/api/fleet/runs/${id}`);
  expect(screen.queryByRole("button", { name: "start" })).toBeNull();
});

it("shows only authorized resource projections and submitted runs in the review view", async () => {
  const resources = {
    drivers: [{ userId: 1, name: "Synthetic authorized driver", fleetIds: [] }],
    equipment: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: "Synthetic held truck",
        category: "truck",
        status: "held",
        dispatchable: false,
      },
    ],
  };
  const run = (id: string, title: string, status: string) => ({
    id,
    title,
    status,
    version: 1,
    driverUserId: 1,
    vehicleAssetId: resources.equipment[0].id,
    trailerAssetId: null,
    allowedActions: [],
    stops: [],
    loads: [],
    inspections: [],
    records: [],
    events: [],
    currentStopId: null,
  });
  mocks.api.mockImplementation(async (path) =>
    path === "/api/fleet/resources"
      ? resources
      : {
          ...overview,
          capabilities: { canDispatch: true, canManage: true, canDrive: false },
          runs: [
            run(
              "20000000-0000-4000-8000-000000000001",
              "Review candidate",
              "submitted_for_review",
            ),
            run(
              "20000000-0000-4000-8000-000000000002",
              "Active work",
              "in_progress",
            ),
          ],
        },
  );
  render(<FleetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Drivers" }));
  expect(screen.getByText("Synthetic held truck")).toBeTruthy();
  expect(screen.getByText("Not ready for dispatch")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fleet Dispatch" }));
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.getByRole("button", { name: "Review candidate" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Active work" })).toBeNull();
  expect(mocks.api.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
    false,
  );
});
vi.mock("@/components/FleetDestinationDirectory", () => ({
  default: () => <div>Reusable destination settings</div>,
}));
vi.mock("@/components/FleetTicketPlan", () => ({
  default: ({ ticketId }: any) => (
    <div>Commercial plan for ticket {ticketId}</div>
  ),
}));
it("requires billing selection and preserves every ordered stop for an existing ticket", async () => {
  const fleetId = "60000000-0000-4000-8000-000000000001",
    vehicleId = "30000000-0000-4000-8000-000000000001";
  const dispatch = {
    ...overview,
    roles: ["dispatcher"],
    capabilities: { canDispatch: true, canDrive: false, canSetup: true },
    fleets: [
      {
        id: fleetId,
        name: "Synthetic Fleet",
        siteIds: [392],
        equipmentAssetIds: [vehicleId],
      },
    ],
  };
  mocks.api.mockImplementation(async (path: string) =>
    path.startsWith("/api/fleet/billing-options")
      ? {
          workTypes: [
            {
              id: 8,
              name: "Catalog haul",
              rateCents: 5000,
              afeNumber: "AFE-SYN",
            },
          ],
          tickets: [
            {
              id: 77,
              ticketNumber: 77,
              siteId: 392,
              afeNumber: "AFE-SYN",
              workDate: "2026-10-16",
              planVersion: 1,
            },
          ],
          afeRequired: true,
          siteAfe: "AFE-SYN",
        }
      : path === "/api/fleet/resources"
        ? {
            drivers: [
              { userId: 5, name: "Synthetic Driver", fleetIds: [fleetId] },
            ],
            equipment: [
              {
                id: vehicleId,
                name: "Synthetic Truck",
                category: "truck",
                status: "ready",
                dispatchable: true,
              },
            ],
          }
        : dispatch,
  );
  render(<FleetWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "New run" }));
  fireEvent.change(screen.getByLabelText("Fleet run title"), {
    target: { value: "Commercial synthetic haul" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Synthetic Fleet" }));
  fireEvent.click(screen.getByRole("button", { name: "Synthetic Driver" }));
  fireEvent.click(screen.getByRole("button", { name: "Use as truck" }));
  fireEvent.click(screen.getByRole("button", { name: "Add site 392" }));
  fireEvent.click(screen.getByRole("button", { name: "delivery stop" }));
  fireEvent.click(screen.getByRole("button", { name: "Add site 392" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Add run to ticket #",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create draft run" }));
  expect(mocks.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Add run to ticket #" }));
  fireEvent.click(await screen.findByRole("button", { name: /Ticket #77/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create draft run" }));
  await waitFor(() =>
    expect(
      mocks.api.mock.calls.some(
        (c) => c[0] === "/api/fleet/runs" && c[1]?.method === "POST",
      ),
    ).toBe(true),
  );
  const request = mocks.api.mock.calls.find(
    (c) => c[0] === "/api/fleet/runs" && c[1]?.method === "POST",
  )!;
  expect(JSON.parse(request[1].body)).toMatchObject({
    billing: { mode: "existing_ticket", ticketId: 77, afeNumber: "AFE-SYN" },
    stops: [
      { siteId: 392, kind: "pickup", sequence: 0 },
      { siteId: 392, kind: "delivery", sequence: 1 },
    ],
  });
  expect(
    screen.queryByText("Operational run without billing ticket"),
  ).toBeNull();
});
it("keeps operational driver details from opening the finance-only ticket plan", async () => {
  const id = "20000000-0000-4000-8000-000000000099";
  const run = {
    id,
    title: "Driver commercial routing",
    version: 1,
    driverUserId: 1,
    vehicleAssetId: "30000000-0000-4000-8000-000000000001",
    trailerAssetId: null,
    status: "draft",
    allowedActions: [],
    currentStopId: null,
    loads: [],
    inspections: [],
    records: [],
    events: [],
    stops: [],
    commercial: {
      ticketId: 88,
      originSiteId: 392,
      mode: "batch",
      currency: "USD",
      approvedDestinations: [],
      destinationId: null,
    },
  };
  mocks.api.mockResolvedValue({ ...overview, runs: [run] });
  render(<FleetWorkspace initialRunId={id} />);
  await screen.findByText("Driver commercial routing");
  expect(screen.queryByText("Commercial plan for ticket 88")).toBeNull();
});
