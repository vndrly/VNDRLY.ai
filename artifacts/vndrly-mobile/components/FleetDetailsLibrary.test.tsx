import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import FleetDetailsLibrary from "./FleetDetailsLibrary";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "white", card: "gray", primary: "gold" }),
}));
vi.mock("./FleetDetails", () => ({
  FleetDetailBuilder: ({ assessments }: any) => (
    <div data-testid="readiness">{JSON.stringify(assessments ?? {})}</div>
  ),
  FleetRigPackageBuilder: () => null,
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("requests scoped company evidence for native Details without making missing compliance a resource-loading blocker", async () => {
  const group = "11111111-1111-4111-8111-111111111111",
    truck = "22222222-2222-4222-8222-222222222222";
  mocks.api.mockImplementation(async (path: string) => {
    if (path.endsWith("/overview"))
      return { companyId: 7, fleets: [{ id: group, name: "Resources" }] };
    if (path.endsWith("/resources"))
      return {
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
      };
    if (path.endsWith("/details"))
      return { details: [], nextCursor: null, canManage: true };
    if (path.endsWith("/rig-packages"))
      return { rigPackages: [], nextCursor: null };
    if (path.endsWith("/assessments"))
      return {
        assessments: [],
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
        ],
      };
    throw new Error("Unexpected route");
  });
  render(<FleetDetailsLibrary />);
  await waitFor(() =>
    expect(screen.getByTestId("readiness").textContent).toContain(
      '"vehicle:' + truck + '":{"status":"green"',
    ),
  );
  expect(screen.getByTestId("readiness").textContent).toContain(
    '"driver:7":{"status":"red"',
  );
  expect(
    mocks.api.mock.calls.find((call) => call[0].endsWith("/assessments"))![1]
      .body,
  ).toContain('"kind":"driver"');
});
