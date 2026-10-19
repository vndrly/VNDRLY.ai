import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    primary: "gold",
    card: "gray",
    background: "black",
    destructive: "red",
  }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
import { FleetDetailBuilder, FleetRigPackageBuilder } from "./FleetDetails";
const group = "11111111-1111-4111-8111-111111111111",
  truck = "22222222-2222-4222-8222-222222222222";
it("creates an ordered native rig package with branded component selection", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <FleetRigPackageBuilder
      companyId={7}
      equipment={[
        {
          id: truck,
          name: "Trailer 7",
          category: "trailer",
          status: "available",
          dispatchable: true,
        },
      ]}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Rig package name"), {
    target: { value: "Crude package" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Trailer 7" }));
  fireEvent.click(screen.getByRole("button", { name: "Review rig package" }));
  fireEvent.click(screen.getByRole("button", { name: "Save rig package" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({
    expectedVersion: 0,
    package: { components: [{ assetId: truck, role: "trailer", sequence: 0 }] },
  });
});
it("reviews a reusable native truck and driver Detail without fabricating custody or driver acceptance", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <FleetDetailBuilder
      companyId={7}
      accessGroupIds={[group]}
      resources={{
        drivers: [{ userId: 2, name: "Bob Villa", fleetIds: [group] }],
        equipment: [
          {
            id: truck,
            name: "Truck 12",
            category: "truck",
            status: "available",
            dispatchable: true,
          },
        ],
      }}
      rigPackages={[]}
      assessments={{[`vehicle:${truck}`]:{status:"green",label:"Current reviewed evidence"},"driver:2":{status:"red",label:"expired"}}}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Detail name"), {
    target: { value: "Support Detail" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Available Trucks" }));
  fireEvent.click(await screen.findByRole("button", { name: "Truck 12" }));
  fireEvent.click(screen.getByRole("button", { name: "Driver" }));
  fireEvent.click(await screen.findByRole("button", { name: "Bob Villa" }));
  expect(await screen.findByText("Bob Villa · expired")).toBeTruthy();
  expect(screen.getByText("Truck 12 · Current reviewed evidence")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review Detail" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save Detail" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({
    expectedVersion: 0,
    detail: { vehicleAssetId: truck, driverUserId: 2, rigPackageId: null },
  });
  expect(save.mock.calls[0][0]).not.toHaveProperty("driverAcknowledged");
});
