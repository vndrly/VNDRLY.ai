import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ setup: vi.fn(), saveSetup: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({
    children,
    color: _color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
import { FleetSetupPanel } from "./fleet-setup";
const fleetId = "22222222-2222-4222-8222-222222222222";
const initial = {
  expectedVersion: 4,
  enabled: false,
  fleets: [
    {
      id: fleetId,
      name: "North fleet",
      siteIds: [10],
      requiredCertifications: [],
      equipmentAssetIds: [],
    },
  ],
  grants: [
    {
      userId: 7,
      roles: ["driver"],
      fleetIds: [fleetId],
      siteIds: [10],
      safetyRelease: true,
      financeRead: true,
    },
  ],
  members: [{ userId: 7, name: "Driver seven" }],
  sites: [{ siteId: 10, name: "North site" }],
  equipment: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.setup.mockResolvedValue(initial);
  api.saveSetup.mockResolvedValue({});
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetSetupPanel identity="company1" />
    </QueryClientProvider>,
  );
describe("Fleet configuration", () => {
  it("saves explicit checklist configuration only through the reviewed company setup", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Profile name"), {
      target: { value: "Fluid hauling" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add requirement" })[0],
    );
    fireEvent.change(screen.getByLabelText("Stable field ID"), {
      target: { value: "brakes" },
    });
    fireEvent.change(screen.getByLabelText("Field label"), {
      target: { value: "Brakes" },
    });
    fireEvent.click(screen.getByLabelText("Required"));
    expect(api.saveSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save reviewed configuration"));
    await waitFor(() => expect(api.saveSetup).toHaveBeenCalledOnce());
    expect(api.saveSetup.mock.calls[0][0].fleets[0].operationalProfile).toEqual(
      {
        name: "Fluid hauling",
        inspectionItems: [{ id: "brakes", label: "Brakes", required: true }],
        manifestFields: [],
      },
    );
  });
  it("preserves explicit support scope and expiry when saving unrelated configuration", async () => {
    const supportGrants = [
      {
        userId: 88,
        fleetIds: [fleetId],
        siteIds: [10],
        expiresAt: "2026-10-10T00:00:00Z",
        reason: "Approved investigation",
        financeRead: false,
      },
    ];
    api.setup.mockResolvedValue({ ...initial, supportGrants });
    mount();
    fireEvent.click(await screen.findByLabelText("Enable Fleet Ops"));
    fireEvent.click(screen.getByText("Save reviewed configuration"));
    await waitFor(() => expect(api.saveSetup).toHaveBeenCalledOnce());
    expect(api.saveSetup.mock.calls[0][0].supportGrants).toEqual(supportGrants);
    expect(api.saveSetup.mock.calls[0][0].grants).toEqual(initial.grants);
  });
  it("changes safety-release authority explicitly without changing finance authority or driver role", async () => {
    mount();
    fireEvent.click(
      await screen.findByLabelText(
        "Authority to release a Fleet safety hold after documented repair and review",
      ),
    );
    fireEvent.click(screen.getByText("Save reviewed configuration"));
    await waitFor(() => expect(api.saveSetup).toHaveBeenCalledOnce());
    expect(api.saveSetup.mock.calls[0][0].grants[0]).toMatchObject({
      roles: ["driver"],
      safetyRelease: false,
      financeRead: true,
    });
  });
  it("sends reviewed version and preserves separate grants without leaking response-only directories", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText("Enable Fleet Ops"));
    fireEvent.click(screen.getByText("Save reviewed configuration"));
    await waitFor(() => expect(api.saveSetup).toHaveBeenCalledOnce());
    expect(api.saveSetup.mock.calls[0][0]).toEqual({
      expectedVersion: 4,
      enabled: true,
      fleets: initial.fleets,
      grants: initial.grants,
    });
  });
  it("does not offer configuration writes when canonical read denies access", async () => {
    api.setup.mockRejectedValueOnce(new Error("403"));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Save reviewed configuration")).toBeNull();
    expect(api.saveSetup).not.toHaveBeenCalled();
  });
});
