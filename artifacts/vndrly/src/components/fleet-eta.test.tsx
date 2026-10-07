import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
const api = vi.hoisted(() => ({ eta: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetEtaPanel } from "./fleet-eta";
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
      <FleetEtaPanel run={run} identity="user:7" />
    </QueryClientProvider>,
  );
}
it("requests only the exact run on demand and reports missing source without an invented estimate", async () => {
  api.eta.mockResolvedValue({
    ok: false,
    runId: run.id,
    code: "fleet.eta_location_unavailable",
    truckSafeRouting: false,
    physicalProofVerified: false,
  });
  show();
  expect(api.eta).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Read current driving estimate" }),
  );
  await screen.findByText(
    "No current sufficiently accurate authorized phone observation is available.",
  );
  expect(api.eta).toHaveBeenCalledWith(run.id);
  expect(screen.queryByText(/miles/)).toBeNull();
});
it("shows source timestamp and hides prior estimate after a current read refusal", async () => {
  api.eta.mockResolvedValue({
    ok: true,
    runId: run.id,
    siteName: "Next site",
    durationMinutes: 12,
    distanceMiles: 4,
    estimatedAt: "2026-10-07T12:00:00Z",
    sourceRecordedAt: "2026-10-07T11:59:00Z",
    sourceAccuracyMeters: 10,
    trafficAware: false,
    routeConfidence: "medium",
  });
  show();
  fireEvent.click(
    screen.getByRole("button", { name: "Read current driving estimate" }),
  );
  await screen.findByText("Next site · 12 minutes · 4 miles");
  expect(screen.getByText(/Phone observation recorded:/)).toBeTruthy();
  api.eta.mockRejectedValue(new Error("revoked"));
  fireEvent.click(
    screen.getByRole("button", { name: "Read current driving estimate" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Next site · 12 minutes · 4 miles")).toBeNull(),
  );
});
