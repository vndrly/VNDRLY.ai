import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  cargoTransfers: vi.fn(),
  cargoTransfer: vi.fn(),
  cargoAction: vi.fn(),
  proposeCargo: vi.fn(),
  run: vi.fn(),
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
import { FleetCargoPanel, fleetCargoCandidates } from "./fleet-cargo";
const run = FleetRunSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  fleetId: "22222222-2222-4222-8222-222222222222",
  companyId: 7,
  title: "Saved draft",
  driverUserId: 8,
  vehicleAssetId: "33333333-3333-4333-8333-333333333333",
  trailerAssetId: null,
  siteIds: [9],
  status: "draft",
  phase: null,
  version: 4,
  stops: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      siteId: 9,
      kind: "pickup",
      sequence: 0,
    },
  ],
  loads: [],
  inspections: [],
  currentStopId: null,
  visitedStopIds: [],
  events: [],
  linkedTicketId: null,
  allowedActions: [],
  canEditDraft: true,
});

const paused = {
  ...run,
  status: "in_progress" as const,
  phase: "paused",
  currentStopId: run.stops[0].id,
};
const target = { ...paused, id: "55555555-5555-4555-8555-555555555555" };
it("offers only paused same-company same-current-site target pickups", () => {
  expect(
    fleetCargoCandidates(paused, [
      target,
      { ...target, id: "66666666-6666-4666-8666-666666666666", companyId: 99 },
      { ...target, phase: "on_site" },
      { ...target, currentStopId: null },
    ]),
  ).toEqual([target]);
  expect(
    fleetCargoCandidates({ ...paused, phase: "on_site" }, [target]),
  ).toEqual([]);
});
it("uses fresh allowedActions and preserves all three versions on unknown retry", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  const record = {
    id,
    companyId: 7,
    sourceRunId: run.id,
    targetRunId: target.id,
    commodity: "Synthetic gravel",
    quantity: 3,
    unit: "tons",
    status: "proposed",
    version: 6,
    sourceRunVersion: 8,
    targetRunVersion: 9,
    sourceAcknowledgedBy: null,
    targetAcknowledgedBy: null,
    allowedActions: ["acknowledge_source"],
    events: [],
  };
  api.cargoTransfers.mockResolvedValue({ runId: run.id, transfers: [record] });
  api.cargoTransfer.mockResolvedValue(record);
  api.cargoAction
    .mockRejectedValueOnce(Error("lost"))
    .mockImplementationOnce(async (_id, input) => ({
      ...record,
      events: [{ operationId: input.operationId }],
    }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetCargoPanel
        run={paused}
        runs={[target]}
        identity="8:7"
        canDispatch={false}
        onSaved={async () => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByLabelText("Target paused run")).toBeNull();
  await screen.findByText("Acknowledge as source driver");
  expect(screen.queryByText("Acknowledge as target driver")).toBeNull();
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Actual source acknowledgment" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Acknowledge as source driver" }),
  );
  await screen.findByRole("button", {
    name: "Save exact reviewed cargo request",
  });
  expect(api.cargoAction).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed cargo request" }),
  );
  await screen.findByText(/Cargo outcome is unverified/);
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed cargo request" }),
  );
  await waitFor(() => expect(api.cargoAction).toHaveBeenCalledTimes(2));
  expect(api.cargoAction.mock.calls[0]).toEqual(api.cargoAction.mock.calls[1]);
  expect(api.cargoAction.mock.calls[0][1]).toMatchObject({
    expectedVersion: 6,
    sourceExpectedVersion: 8,
    targetExpectedVersion: 9,
    action: "acknowledge_source",
  });
});
it("reviews freshly read source and target revisions before a manager proposal", async () => {
  const loadId = "88888888-8888-4888-8888-888888888888",
    deliveryId = "99999999-9999-4999-8999-999999999999";
  const source = FleetRunSchema.parse({
    ...paused,
    loads: [
      {
        id: loadId,
        pickupStopId: paused.currentStopId,
        deliveryStopId: null,
        commodity: "Reported gravel",
        quantity: 3,
        unit: "tons",
        manifestReference: "ACTUAL-REPORTED",
        deliveryReference: null,
        recordedByUserId: 8,
        recordedAt: "2026-10-07T00:00:00Z",
        deliveredAt: null,
        source: "user_report",
      },
    ],
  });
  const destination = FleetRunSchema.parse({
    ...target,
    stops: [
      ...target.stops,
      { id: deliveryId, siteId: 9, kind: "delivery", sequence: 1 },
    ],
  });
  api.cargoTransfers.mockResolvedValue({ runId: run.id, transfers: [] });
  api.run.mockImplementation(async (id) =>
    id === run.id
      ? { ...source, version: 12 }
      : { ...destination, version: 13 },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetCargoPanel
        run={source}
        runs={[destination]}
        identity="8:7"
        canDispatch
        onSaved={async () => {}}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Target paused run"), {
    target: { value: destination.id },
  });
  fireEvent.change(screen.getByLabelText("Full undelivered source load"), {
    target: { value: loadId },
  });
  fireEvent.change(screen.getByLabelText("Later target delivery stop"), {
    target: { value: deliveryId },
  });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Actual transfer report" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Read current pair and review proposal",
    }),
  );
  await screen.findByRole("button", {
    name: "Save exact reviewed cargo request",
  });
  expect(screen.getByText(/Proposed reported transfer/).textContent).toContain(
    "12 / 13",
  );
  expect(api.run).toHaveBeenCalledWith(source.id);
  expect(api.run).toHaveBeenCalledWith(destination.id);
  expect(api.proposeCargo).not.toHaveBeenCalled();
});
it("reviews current pair versions to cancel a proposal after run changes", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  const record = {
    id,
    companyId: 7,
    sourceRunId: run.id,
    targetRunId: target.id,
    commodity: "Synthetic gravel",
    quantity: 3,
    unit: "tons",
    status: "proposed",
    version: 6,
    sourceRunVersion: 8,
    targetRunVersion: 9,
    sourceAcknowledgedBy: null,
    targetAcknowledgedBy: null,
    allowedActions: ["cancel"],
    events: [],
  };
  api.cargoTransfers.mockResolvedValue({ runId: run.id, transfers: [record] });
  api.cargoTransfer.mockResolvedValue(record);
  api.run.mockImplementation(async (id) =>
    id === run.id ? { ...paused, version: 18 } : { ...target, version: 19 },
  );
  api.cargoAction.mockReset();
  api.cargoAction.mockImplementation(async (_id, input) => ({
    ...record,
    events: [{ operationId: input.operationId }],
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetCargoPanel
        run={paused}
        runs={[target]}
        identity="8:7"
        canDispatch
        onSaved={async () => {}}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Cancel" });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Cancel stale proposed transfer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByRole("button", {
    name: "Save exact reviewed cargo request",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed cargo request" }),
  );
  await waitFor(() => expect(api.cargoAction).toHaveBeenCalledTimes(1));
  expect(api.cargoAction.mock.calls[0][1]).toMatchObject({
    action: "cancel",
    expectedVersion: 6,
    sourceExpectedVersion: 18,
    targetExpectedVersion: 19,
  });
});
