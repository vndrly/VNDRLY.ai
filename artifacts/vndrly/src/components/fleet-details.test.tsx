import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FleetDetailBuilder, FleetRigPackageBuilder } from "./fleet-details";
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
const group = "11111111-1111-4111-8111-111111111111",
  truck = "22222222-2222-4222-8222-222222222222",
  trailer = "33333333-3333-4333-8333-333333333333";
const resources = {
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
  tickets: [],
};
const rig = {
  id: "44444444-4444-4444-8444-444444444444",
  companyId: 7,
  version: 2,
  name: "Crude trailer and pump",
  components: [{ assetId: trailer, role: "trailer" as const, sequence: 0 }],
  effectiveFrom: "2026-10-15T12:00:00Z",
  effectiveUntil: null,
  archivedAt: null,
};
describe("Inventory and Details builder", () => {
  it("assembles a reusable package from ordered canonical Inventory components", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <FleetRigPackageBuilder
        companyId={7}
        equipment={[
          {
            id: trailer,
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
      package: {
        name: "Crude package",
        components: [{ assetId: trailer, role: "trailer", sequence: 0 }],
      },
    });
  });
  it("combines three canonical selections without changing Inventory custody", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <FleetDetailBuilder
        companyId={7}
        accessGroupIds={[group]}
        resources={resources}
        rigPackages={[rig]}
        assessments={{
          [truck]: { status: "red", label: "Registration expired" },
        }}
        onSave={save}
      />,
    );
    fireEvent.change(screen.getByLabelText("Detail name"), {
      target: { value: "Bob crude hauler" },
    });
    fireEvent.change(screen.getByLabelText("Available Trucks"), {
      target: { value: truck },
    });
    fireEvent.change(screen.getByLabelText("Available Rig"), {
      target: { value: rig.id },
    });
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "2" },
    });
    expect(screen.getByText(/Registration expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review Detail" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Detail" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      expectedVersion: 0,
      detail: {
        companyId: 7,
        vehicleAssetId: truck,
        rigPackageId: rig.id,
        rigPackageVersion: 2,
        driverUserId: 2,
        accessGroupIds: [group],
      },
    });
    expect(save.mock.calls[0][0]).not.toHaveProperty("custody");
  });
  it("allows truck-only work and keeps an identical retry after a lost response", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValue(undefined);
    render(
      <FleetDetailBuilder
        companyId={7}
        accessGroupIds={[group]}
        resources={resources}
        rigPackages={[]}
        onSave={save}
      />,
    );
    fireEvent.change(screen.getByLabelText("Detail name"), {
      target: { value: "Support" },
    });
    fireEvent.change(screen.getByLabelText("Available Trucks"), {
      target: { value: truck },
    });
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Detail" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Detail" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save Detail" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
    expect(save.mock.calls[0][0].detail.rigPackageId).toBeNull();
  });
});
