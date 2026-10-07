import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  replacements: vi.fn(),
  proposeReplacement: vi.fn(),
  replacementAction: vi.fn(),
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
import { FleetReplacementPanel } from "./fleet-replacement";
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

const paused = { ...run, status: "in_progress" as const, phase: "paused" };
const replacementId = "66666666-6666-4666-8666-666666666666",
  vehicle = "55555555-5555-4555-8555-555555555555";
function panel(canDispatch: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <FleetReplacementPanel
        run={paused}
        identity="8:7"
        canDispatch={canDispatch}
        equipment={[
          {
            id: vehicle,
            name: "Actual candidate",
            category: "truck",
            status: "checked_out",
            dispatchable: true,
          },
        ]}
        onSaved={async () => {}}
      />
    </QueryClientProvider>,
  );
}
it("reviews fresh run revision and preserves exact replacement after unknown proposal", async () => {
  api.replacements.mockResolvedValue({ runId: run.id, replacements: [] });
  api.run.mockResolvedValue({ ...paused, version: 8 });
  api.proposeReplacement
    .mockRejectedValueOnce(Error("lost"))
    .mockImplementationOnce(async (_id, input) => ({
      id: replacementId,
      companyId: 7,
      runId: run.id,
      events: [{ operationId: input.operationId }],
    }));
  panel(true);
  fireEvent.change(screen.getByLabelText("Replacement vehicle candidate"), {
    target: { value: vehicle },
  });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Actual broken truck report" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Read current run and review replacement",
    }),
  );
  await screen.findByRole("button", {
    name: "Save exact reviewed replacement",
  });
  expect(api.proposeReplacement).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed replacement" }),
  );
  await screen.findByText(/Replacement outcome is unverified/);
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed replacement" }),
  );
  await waitFor(() => expect(api.proposeReplacement).toHaveBeenCalledTimes(2));
  expect(api.proposeReplacement.mock.calls[0]).toEqual(
    api.proposeReplacement.mock.calls[1],
  );
  expect(api.proposeReplacement.mock.calls[0][1]).toMatchObject({
    expectedVersion: 8,
    vehicleAssetId: vehicle,
    trailerAssetId: null,
    reason: "Actual broken truck report",
  });
});
it("uses only fresh own driver acceptance permission and exact record/run versions", async () => {
  const record = {
    id: replacementId,
    runId: run.id,
    companyId: 7,
    driverUserId: 8,
    priorVehicleAssetId: run.vehicleAssetId,
    priorTrailerAssetId: null,
    vehicleAssetId: vehicle,
    trailerAssetId: null,
    status: "proposed",
    version: 2,
    runVersion: 9,
    reason: "Actual truck replacement",
    acceptedAt: null,
    acceptedByUserId: null,
    events: [],
    allowedActions: ["accept"],
  };
  api.replacements.mockResolvedValue({ runId: run.id, replacements: [record] });
  api.replacementAction.mockImplementationOnce(
    async (_id, _replacementId, input) => ({
      ...record,
      events: [{ operationId: input.operationId }],
    }),
  );
  panel(false);
  expect(screen.queryByLabelText("Replacement vehicle candidate")).toBeNull();
  await screen.findByRole("button", {
    name: "Review acceptance as assigned driver",
  });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Actual driver acceptance" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Review acceptance as assigned driver",
    }),
  );
  await screen.findByRole("button", {
    name: "Save exact reviewed replacement",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed replacement" }),
  );
  await waitFor(() => expect(api.replacementAction).toHaveBeenCalledTimes(1));
  expect(api.replacementAction.mock.calls[0][2]).toMatchObject({
    action: "accept",
    expectedVersion: 2,
    runExpectedVersion: 9,
    notes: "Actual driver acceptance",
  });
});
it("can review cancellation using the current run revision after a stale proposal", async () => {
  const record = {
    id: replacementId,
    runId: run.id,
    companyId: 7,
    driverUserId: 8,
    priorVehicleAssetId: run.vehicleAssetId,
    priorTrailerAssetId: null,
    vehicleAssetId: vehicle,
    trailerAssetId: null,
    status: "proposed",
    version: 2,
    runVersion: 4,
    reason: "Stale proposal",
    acceptedAt: null,
    acceptedByUserId: null,
    events: [],
    allowedActions: ["cancel"],
  };
  api.replacements.mockResolvedValue({ runId: run.id, replacements: [record] });
  api.run.mockResolvedValue({ ...paused, version: 12 });
  api.replacementAction.mockReset();
  api.replacementAction.mockImplementation(
    async (_id, _replacementId, input) => ({
      ...record,
      events: [{ operationId: input.operationId }],
    }),
  );
  panel(true);
  await screen.findByRole("button", { name: "Cancel" });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Cancel stale equipment proposal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByRole("button", {
    name: "Save exact reviewed replacement",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save exact reviewed replacement" }),
  );
  await waitFor(() => expect(api.replacementAction).toHaveBeenCalledTimes(1));
  expect(api.replacementAction.mock.calls[0][2]).toMatchObject({
    action: "cancel",
    expectedVersion: 2,
    runExpectedVersion: 12,
  });
});
