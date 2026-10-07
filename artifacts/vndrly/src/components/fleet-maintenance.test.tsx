import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FleetRunSchema, type FleetOverview } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  maintenance: vi.fn(),
  maintenanceDetail: vi.fn(),
  createMaintenance: vi.fn(),
  maintenanceAction: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetMaintenancePanel } from "./fleet-maintenance";
const fleetId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const recordId = "55555555-5555-4555-8555-555555555555";
const ownRun = FleetRunSchema.parse({
  id: runId,
  fleetId,
  companyId: 1,
  title: "Own hauling run",
  driverUserId: 7,
  vehicleAssetId: assetId,
  trailerAssetId: null,
  siteIds: [10],
  status: "acknowledged",
  phase: null,
  version: 1,
  stops: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      siteId: 10,
      kind: "pickup",
      sequence: 0,
    },
  ],
  inspections: [],
  currentStopId: null,
  visitedStopIds: [],
  loads: [],
  events: [],
  linkedTicketId: null,
  allowedActions: [],
  labels: {
    driverName: "Driver seven",
    vehicleName: "Truck seven",
    trailerName: null,
    sites: [{ siteId: 10, name: "North site" }],
  },
});
const overview: FleetOverview = {
  companyId: 1,
  enabled: true,
  roles: ["driver"],
  observations: [],
  unavailableIntegrations: [],
  generatedAt: "2026-10-07T00:00:00Z",
  capabilities: {
    canManage: false,
    canDispatch: false,
    canDrive: true,
    canSetup: false,
    canMaintain: false,
    canReportDefect: true,
  },
  fleets: [
    {
      id: fleetId,
      name: "North fleet",
      siteIds: [10],
      equipmentAssetIds: [assetId],
      requiredCertifications: [],
    },
  ],
  runs: [
    ownRun,
    {
      ...ownRun,
      id: "66666666-6666-4666-8666-666666666666",
      driverUserId: 8,
      title: "Other driver run",
    },
  ],
};
const record = {
  id: recordId,
  companyId: 1,
  fleetId,
  assetId,
  runId,
  kind: "defect",
  title: "Reported tire defect",
  status: "in_service",
  version: 4,
  holdId: null,
  dueAt: null,
  events: [],
  allowedActions: ["record_repair"],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.maintenance.mockResolvedValue({
    records: [],
    nextCursor: null,
    generatedAt: "2026-10-07T00:00:00Z",
  });
  api.maintenanceDetail.mockResolvedValue(record);
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetMaintenancePanel
        overview={overview}
        identity="company1-user7"
        userId={7}
      />
    </QueryClientProvider>,
  );
describe("Fleet maintenance", () => {
  it("reports only own assigned equipment and keeps exact operation identity after unknown outcome", async () => {
    api.createMaintenance
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async (...args: unknown[]) => {
        const input = args.at(-1) as { operationId: string };
        return { ...record, events: [{ operationId: input.operationId }] };
      });
    mount();
    expect(screen.queryByText("Other driver run")).toBeNull();
    expect(screen.queryByText("Scheduled service")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your assigned run"), {
      target: { value: runId },
    });
    fireEvent.change(screen.getByLabelText("Authorized equipment"), {
      target: { value: assetId },
    });
    fireEvent.change(screen.getByLabelText("Report title"), {
      target: { value: "Reported tire defect" },
    });
    fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
      target: { value: "I observed a damaged tire while stopped." },
    });
    fireEvent.click(screen.getByText("Review exact report"));
    expect(api.createMaintenance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save reviewed report"));
    await screen.findByText(/outcome was not confirmed/);
    fireEvent.click(screen.getByText("Save reviewed report"));
    await waitFor(() => expect(api.createMaintenance).toHaveBeenCalledTimes(2));
    expect(api.createMaintenance.mock.calls[0][0]).toEqual(
      api.createMaintenance.mock.calls[1][0],
    );
    await screen.findByText(
      "Report saved. Refresh shows its current authorized outcome.",
    );
    expect(api.createMaintenance.mock.calls[0][0]).toEqual({
      operationId: expect.any(String),
      fleetId,
      assetId,
      runId,
      kind: "defect",
      title: "Reported tire defect",
      notes: "I observed a damaged tire while stopped.",
    });
  });
  it("uses server-permitted actions and retries exact reviewed version without inventing release permission", async () => {
    api.maintenance.mockResolvedValue({
      records: [record],
      nextCursor: null,
      generatedAt: "2026-10-07T00:00:00Z",
    });
    api.maintenanceAction
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(
        async (_id: string, input: { operationId: string }) => ({
          ...record,
          events: [{ operationId: input.operationId }],
        }),
      );
    mount();
    fireEvent.click(await screen.findByText("Reported tire defect"));
    await screen.findByText("Record reported repair");
    expect(
      screen.queryByText("Release safety hold after repair review"),
    ).toBeNull();
    const notes = screen.getAllByLabelText("Actual observations and notes");
    fireEvent.change(notes[1], {
      target: { value: "Repair reported; reviewed work record." },
    });
    fireEvent.click(screen.getByText("Record reported repair"));
    expect(api.maintenanceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save reviewed maintenance action"));
    await screen.findByText(/outcome was not confirmed/);
    fireEvent.click(screen.getByText("Save reviewed maintenance action"));
    await waitFor(() => expect(api.maintenanceAction).toHaveBeenCalledTimes(2));
    expect(api.maintenanceAction.mock.calls[0]).toEqual(
      api.maintenanceAction.mock.calls[1],
    );
    await screen.findByText(
      "Report saved. Refresh shows its current authorized outcome.",
    );
    expect(api.maintenanceAction.mock.calls[0]).toEqual([
      recordId,
      {
        operationId: expect.any(String),
        expectedVersion: 4,
        action: "record_repair",
        notes: "Repair reported; reviewed work record.",
      },
    ]);
  });
});
