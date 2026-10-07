import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FleetRunSchema, type FleetGateObservations } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  gateObservations: vi.fn(),
  linkGateVisit: vi.fn(),
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
import { FleetGateObservationsPanel } from "./fleet-gate-observations";
const run = FleetRunSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  fleetId: "22222222-2222-4222-8222-222222222222",
  companyId: 1,
  title: "Own run",
  driverUserId: 7,
  vehicleAssetId: "33333333-3333-4333-8333-333333333333",
  trailerAssetId: null,
  siteIds: [10, 20],
  status: "in_progress",
  phase: "en_route",
  version: 11,
  stops: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      siteId: 10,
      kind: "pickup",
      sequence: 0,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      siteId: 20,
      kind: "delivery",
      sequence: 1,
    },
  ],
  loads: [],
  inspections: [],
  currentStopId: null,
  visitedStopIds: [],
  events: [],
  linkedTicketId: null,
  allowedActions: [],
});
const data: FleetGateObservations = {
  runId: run.id,
  version: 12,
  observations: [5, 6].map((visitId) => ({
    visitId,
    siteId: 10,
    vehicleAssetId: run.vehicleAssetId,
    checkInAt: "2026-10-07T12:00:00Z",
    checkOutAt: null,
    observedArrivalAt: null,
    observedDepartureAt: null,
    source: null,
    reconciliationState: "unverified",
  })),
  ambiguous: true,
  basis: "same_equipment_site_time_window",
  automaticAdmissionCreated: false,
  canLink: true,
  links: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.gateObservations.mockResolvedValue(data);
});
const saved = vi.fn(async () => {});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetGateObservationsPanel
        run={run}
        identity="company1-user7"
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
describe("Fleet Gate observations", () => {
  it("requires explicit same-site selection and retries the same current server version without admission or GPS arguments", async () => {
    api.linkGateVisit
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(
        async (
          _id: string,
          input: { operationId: string; stopId: string; visitId: number },
        ) => ({
          runId: run.id,
          ...input,
          version: 13,
          recordedAt: "2026-10-07T12:10:00Z",
          observation: data.observations[0],
          automaticAdmissionCreated: false,
        }),
      );
    mount();
    await screen.findByText(
      /Multiple possible visits require explicit selection/,
    );
    expect(screen.getAllByText(/Source not reported/).length).toBeGreaterThan(
      0,
    );
    expect(api.linkGateVisit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Existing Gate visit"), {
      target: { value: "5" },
    });
    expect(screen.queryByRole("option", { name: /delivery/ })).toBeNull();
    fireEvent.change(
      screen.getByLabelText("Select the exact same-site run stop"),
      { target: { value: run.stops[0].id } },
    );
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Reviewed the exact visit and pickup stop." },
    });
    fireEvent.click(screen.getByText("Review exact visit link"));
    expect(api.linkGateVisit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save reviewed visit link"));
    await screen.findByText(/Link outcome was not confirmed/);
    fireEvent.click(screen.getByText("Save reviewed visit link"));
    await screen.findByText(/Existing visit linked to this run stop/);
    await waitFor(() => expect(api.linkGateVisit).toHaveBeenCalledTimes(2));
    expect(api.linkGateVisit.mock.calls[0]).toEqual(
      api.linkGateVisit.mock.calls[1],
    );
    expect(api.linkGateVisit.mock.calls[0]).toEqual([
      run.id,
      {
        operationId: expect.any(String),
        expectedVersion: 12,
        visitId: 5,
        stopId: run.stops[0].id,
        reason: "Reviewed the exact visit and pickup stop.",
      },
    ]);
  });
  it("shows source records but hides linking when current server authority is read only", async () => {
    api.gateObservations.mockResolvedValue({ ...data, canLink: false });
    mount();
    await screen.findByText(/Existing Gate visit #5/);
    expect(screen.queryByLabelText("Existing Gate visit")).toBeNull();
    expect(screen.queryByText("Review exact visit link")).toBeNull();
    expect(api.linkGateVisit).not.toHaveBeenCalled();
  });
});
