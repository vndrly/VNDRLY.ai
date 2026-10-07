import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { FleetOverview, FleetResources } from "@workspace/api-zod";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
import { FleetManagementProjections } from "./fleet-management-projections";
const data: FleetOverview = {
  companyId: 1,
  enabled: true,
  roles: ["dispatcher"],
  capabilities: {
    canDispatch: true,
    canManage: false,
    canDrive: false,
    canSetup: false,
  },
  fleets: [
    {
      id: "fleet-a",
      name: "A",
      siteIds: [1],
      requiredCertifications: [],
      equipmentAssetIds: ["truck-a"],
    },
    {
      id: "fleet-b",
      name: "B",
      siteIds: [2],
      requiredCertifications: [],
      equipmentAssetIds: ["truck-b"],
    },
  ],
  runs: [],
  observations: [],
  unavailableIntegrations: [],
  generatedAt: "2026-10-07T00:00:00Z",
};
const resources: FleetResources = {
  drivers: [
    { name: "A driver", userId: 1, fleetIds: ["fleet-a"] },
    { name: "B driver", userId: 2, fleetIds: ["fleet-b"] },
  ],
  equipment: [
    {
      id: "truck-a",
      name: "A truck",
      category: "truck",
      status: "good",
      dispatchable: true,
    },
    {
      id: "truck-b",
      name: "B truck",
      category: "truck",
      status: "held",
      dispatchable: false,
    },
  ],
};
it("limits directory projections to the selected fleet", () => {
  render(
    <FleetManagementProjections
      section="equipment"
      data={data}
      resources={resources}
      runs={[]}
      fleetId="fleet-a"
      search=""
    />,
  );
  expect(screen.getByText("A truck · truck")).toBeTruthy();
  expect(screen.queryByText("B truck · truck")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Open canonical Inventory" })
      .getAttribute("href"),
  ).toBe("/work-hub/inventory");
});
it("does not disclose the dispatch directory to a driver even if resources were cached", () => {
  render(
    <FleetManagementProjections
      section="drivers"
      data={{
        ...data,
        roles: ["driver"],
        capabilities: {
          ...data.capabilities,
          canDispatch: false,
          canDrive: true,
        },
      }}
      resources={resources}
      runs={[]}
      fleetId=""
      search=""
    />,
  );
  expect(screen.queryByText("A driver")).toBeNull();
  expect(screen.queryByText("B driver")).toBeNull();
});
