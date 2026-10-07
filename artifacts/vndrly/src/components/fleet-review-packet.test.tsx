import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
const api = vi.hoisted(() => ({ reviewPacket: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
import { FleetReviewPacketPanel } from "./fleet-review-packet";
const run = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 4,
} as FleetRun;
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetReviewPacketPanel run={run} identity="account:7" />
    </QueryClientProvider>,
  );
}
it("shows exact saved missing associations without claiming physical proof", async () => {
  api.reviewPacket.mockResolvedValue({
    runId: run.id,
    runVersion: 4,
    missingRequiredCount: 1,
    inspectionExceptions: 2,
    undeliveredLoadCount: 0,
    requirements: [
      {
        id: "scale",
        label: "Load scale document",
        kind: "scale",
        scope: "each_load",
        required: true,
        loadId: "load1",
        evidenceIds: [],
        missing: true,
      },
    ],
  });
  show();
  await screen.findByText(/Missing required saved-file associations: 1/);
  expect(screen.getByText(/Load scale document/)).toBeTruthy();
  expect(screen.getByText(/do not verify physical proof/)).toBeTruthy();
  expect(api.reviewPacket).toHaveBeenCalledWith(run.id);
});
it("refuses a mismatching run version rather than showing stale completeness", async () => {
  api.reviewPacket.mockResolvedValue({
    runId: run.id,
    runVersion: 3,
    missingRequiredCount: 0,
    requirements: [],
  });
  show();
  await screen.findByText(
    "Current review records are unavailable. Refresh before reviewing closeout.",
  );
  expect(screen.queryByText(/Recorded requirements are complete/)).toBeNull();
});

it("does not report readiness when files exist but inspection records are incomplete", async () => {
  api.reviewPacket.mockResolvedValue({
    runId: run.id,
    runVersion: 4,
    missingRequiredCount: 0,
    readyForOperationalReview: false,
    inspectionComplete: false,
    manifestComplete: true,
    closeoutRecordsComplete: true,
    inspectionExceptions: 0,
    undeliveredLoadCount: 0,
    requirements: [],
  });
  show();
  await screen.findByText(/Recorded inspection: Incomplete/);
  expect(screen.queryByText(/Recorded requirements are complete/)).toBeNull();
});
