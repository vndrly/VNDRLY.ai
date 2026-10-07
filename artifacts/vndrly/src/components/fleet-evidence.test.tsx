import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
const api = vi.hoisted(() => ({ evidence: vi.fn(), addEvidence: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("@/lib/fleet-evidence-upload", () => ({
  validateFleetEvidenceFile: vi.fn(),
  fleetEvidenceFileSha256: async () => "a".repeat(64),
  uploadFleetEvidence: async () =>
    "/objects/uploads/55555555-5555-4555-8555-555555555555",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetEvidencePanel } from "./fleet-evidence";
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

function panel(canAdd: boolean) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetEvidencePanel
        run={{ ...run, status: "acknowledged" }}
        identity="8:7"
        userId={8}
        canAdd={canAdd}
        onSaved={async () => {}}
      />
    </QueryClientProvider>,
  );
}
it("does not expose upload controls to an authorized read-only viewer", async () => {
  api.evidence.mockResolvedValue({ runId: run.id, evidence: [] });
  panel(false);
  expect(screen.queryByLabelText("Choose file")).toBeNull();
});
it("retains exact operation/version/file association after a dropped response", async () => {
  api.evidence.mockResolvedValue({ runId: run.id, evidence: [] });
  api.addEvidence.mockReset();
  api.addEvidence
    .mockRejectedValueOnce(Error("lost"))
    .mockImplementationOnce(async (_id, input) => ({
      ...input,
      runId: run.id,
      companyId: 7,
      recordedByUserId: 8,
      sha256: "a".repeat(64),
      size: 3,
      contentType: "application/pdf",
    }));
  panel(true);
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: {
      files: [new File(["abc"], "actual.pdf", { type: "application/pdf" })],
    },
  });
  fireEvent.change(screen.getByLabelText("Actual observations and notes"), {
    target: { value: "Actual reported document" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review exact file association" }),
  );
  await screen.findByRole("button", {
    name: "Upload and save reviewed association",
  });
  expect(api.addEvidence).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Upload and save reviewed association",
    }),
  );
  await waitFor(() => expect(api.addEvidence).toHaveBeenCalledTimes(1));
  await screen.findByText(/Association outcome is unverified/);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Upload and save reviewed association",
    }),
  );
  await waitFor(() => expect(api.addEvidence).toHaveBeenCalledTimes(2));
  expect(api.addEvidence.mock.calls[0]).toEqual(api.addEvidence.mock.calls[1]);
  expect(api.addEvidence.mock.calls[0][1]).toMatchObject({
    expectedVersion: 4,
    notes: "Actual reported document",
  });
  await screen.findByText("File association verified in the saved run.");
});
