import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FleetOverview,
  FleetReport,
  FleetSavedView,
} from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  report: vi.fn(),
  savedViews: vi.fn(),
  saveView: vi.fn(),
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
import { FleetReportsPanel } from "./fleet-reports";
const fleetId = "22222222-2222-4222-8222-222222222222";
const overview: FleetOverview = {
  companyId: 1,
  enabled: true,
  capabilities: {
    canManage: false,
    canDispatch: false,
    canDrive: true,
    canSetup: false,
  },
  roles: ["driver"],
  fleets: [
    {
      id: fleetId,
      name: "North fleet",
      siteIds: [10],
      equipmentAssetIds: [],
      requiredCertifications: [],
    },
  ],
  runs: [],
  observations: [],
  unavailableIntegrations: [],
  generatedAt: "2026-10-07T00:00:00Z",
};
const report: FleetReport = {
  generatedAt: overview.generatedAt,
  filters: {},
  source: "recorded_fleet_events",
  dateBasis: "run_created_at",
  runCount: 2,
  completedRunCount: 1,
  submittedRunCount: 1,
  inspectionExceptions: 0,
  loadTotals: [
    {
      commodity: "Water",
      unit: "barrels",
      quantity: 100,
      deliveredQuantity: 50,
    },
  ],
  distanceTotals: [
    { unit: "miles", distance: 20 },
    { unit: "kilometers", distance: 10 },
  ],
  fuelTotals: null,
  unavailableMetrics: [
    { metric: "ETA", reason: "No verified location source" },
  ],
};
const view: FleetSavedView = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: 7,
  companyId: 1,
  version: 4,
  name: "North morning",
  filters: { fleetId },
  archived: false,
  recordedAt: overview.generatedAt,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.report.mockResolvedValue(report);
  api.savedViews.mockResolvedValue({ views: [view] });
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetReportsPanel overview={overview} identity="company1-user7" />
    </QueryClientProvider>,
  );
describe("Fleet reports and personal filters", () => {
  it("preserves recorded units and displays restricted fuel as unavailable rather than a fabricated zero", async () => {
    mount();
    await screen.findByText("100 barrels");
    expect(screen.getByText("50 barrels")).toBeTruthy();
    expect(screen.getByText("20 miles")).toBeTruthy();
    expect(screen.getByText("10 kilometers")).toBeTruthy();
    expect(
      screen.getByText(/Fuel totals are unavailable without separate/),
    ).toBeTruthy();
    expect(screen.getByText("ETA: No verified location source")).toBeTruthy();
  });
  it("saves the exact personal view revision and operation again after an unknown outcome", async () => {
    api.saveView
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async (input: { operationId: string }) => ({
        ...view,
        version: 5,
        name: "North revised",
        lastOperationId: input.operationId,
      }));
    mount();
    await screen.findByRole("option", { name: "North morning" });
    fireEvent.change(screen.getByLabelText("Your saved filters"), {
      target: { value: view.id },
    });
    fireEvent.change(screen.getByLabelText("Saved filter name"), {
      target: { value: "North revised" },
    });
    fireEvent.click(screen.getByText("Review filter save"));
    expect(api.saveView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save reviewed filter change"));
    await screen.findByText(/Filter outcome was not confirmed/);
    fireEvent.click(screen.getByText("Save reviewed filter change"));
    await waitFor(() => expect(api.saveView).toHaveBeenCalledTimes(2));
    expect(api.saveView.mock.calls[0][0]).toEqual(
      api.saveView.mock.calls[1][0],
    );
    await screen.findByText(/Personal filter saved/);
    expect(api.saveView.mock.calls[0][0]).toEqual({
      operationId: expect.any(String),
      viewId: view.id,
      expectedVersion: 4,
      action: "save",
      name: "North revised",
      filters: { fleetId },
    });
  });
});

it("shows timing source cohorts and excludes verified duty claims", async () => {
  api.report.mockResolvedValue({
    ...report,
    recordedTiming: {
      eligibleRunCount: 2,
      invalidSequenceCount: 1,
      elapsedMinutes: 90,
      pausedMinutes: 20,
      activeMinutes: 70,
      plannedStartCount: 2,
      lateStartCount: 1,
      startOffsetTotalMinutes: 10,
      plannedFinishCount: 1,
      lateFinishCount: 1,
      finishOffsetTotalMinutes: 5,
      source: "server_recorded_event_times",
      physicalPresenceVerified: false,
      contractualTimelinessVerified: false,
    },
  });
  mount();
  await screen.findByText("Runs with usable start-to-closeout records: 2");
  expect(
    screen.getByText("Runs excluded for invalid event order: 1"),
  ).toBeTruthy();
  expect(
    screen.getByText("Recorded elapsed minutes excluding pauses: 70"),
  ).toBeTruthy();
  expect(screen.getByText(/not verified physical presence/)).toBeTruthy();
});
