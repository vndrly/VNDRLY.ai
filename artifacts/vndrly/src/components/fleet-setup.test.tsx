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
