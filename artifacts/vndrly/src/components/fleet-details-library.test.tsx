import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { FleetDetailsLibrary } from "./fleet-details-library";
const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  resources: vi.fn(),
  details: vi.fn(),
  rigPackages: vi.fn(),
  assessCompliance: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: mocks }));
vi.mock("./fleet-details", () => ({
  FleetDetailBuilder: ({ assessments }: any) => (
    <div data-testid="readiness">{JSON.stringify(assessments ?? {})}</div>
  ),
  FleetRigPackageBuilder: () => null,
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("loads real scoped resource assessments separately and keeps the Detail builder usable when evidence is unavailable", async () => {
  const group = "11111111-1111-4111-8111-111111111111",
    truck = "22222222-2222-4222-8222-222222222222";
  mocks.overview.mockResolvedValue({
    companyId: 7,
    fleets: [{ id: group, name: "Company resources" }],
  });
  mocks.resources.mockResolvedValue({
    drivers: [{ userId: 7, name: "Bob", fleetIds: [group] }],
    equipment: [
      {
        id: truck,
        name: "Truck",
        category: "truck",
        status: "available",
        dispatchable: true,
      },
    ],
    tickets: [],
  });
  mocks.details.mockResolvedValue({
    details: [],
    nextCursor: null,
    canManage: true,
  });
  mocks.rigPackages.mockResolvedValue({
    rigPackages: [],
    nextCursor: null,
    canManage: true,
  });
  mocks.assessCompliance.mockResolvedValue({
    mode: "warn_only",
    summaries: [
      {
        subject: { kind: "vehicle", id: truck },
        status: "green",
        evaluatedAt: "2026-10-16T18:00:00Z",
        freshness: "current",
        reasons: [],
        dueSoon: [],
      },
      {
        subject: { kind: "driver", id: 7 },
        status: "red",
        evaluatedAt: "2026-10-16T18:00:00Z",
        freshness: "current",
        reasons: [
          {
            requirementId: "license",
            requirementVersion: 1,
            category: "driver_license",
            reason: "expired",
            label: "Recorded requirement expired",
          },
        ],
        dueSoon: [],
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FleetDetailsLibrary identity="company7" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("readiness").textContent).toContain(
      '"vehicle:' + truck + '":{"status":"green"',
    ),
  );
  expect(screen.getByTestId("readiness").textContent).toContain("expired");
  expect(mocks.assessCompliance).toHaveBeenCalledWith(
    expect.arrayContaining([
      { kind: "vehicle", id: truck },
      { kind: "driver", id: 7 },
    ]),
  );
  mocks.assessCompliance.mockRejectedValue(new Error("Offline"));
  await client.invalidateQueries({
    queryKey: ["fleet-detail-compliance", "company7"],
  });
  await waitFor(() =>
    expect(screen.getByTestId("readiness").textContent).not.toContain(
      '"status":"green"',
    ),
  );
  expect(screen.getByText("Build Detail")).toBeTruthy();
});
