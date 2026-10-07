import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetOverview } from "@workspace/api-zod";
const api = vi.hoisted(() => ({ savePreference: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetPreferences } from "./fleet-preferences";
const overview = {
  capabilities: {
    canDrive: true,
    canDispatch: false,
    canManage: false,
    canSetup: false,
  },
  fleets: [{ id: "22222222-2222-4222-8222-222222222222", name: "North fleet" }],
  preference: {
    userId: 7,
    version: 4,
    defaultWorkspace: "standard",
    selectedFleetId: null,
  },
} as FleetOverview;
beforeEach(() => {
  vi.clearAllMocks();
  api.savePreference.mockResolvedValue({});
});
describe("Fleet personal preference", () => {
  it("offers only granted workspaces and sends the reviewed version without actor or grant fields", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FleetPreferences overview={overview} identity="company1-member7" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("option", { name: "Fleet Desk" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Default home"), {
      target: { value: "fleet_my_day" },
    });
    fireEvent.click(screen.getByText("Save reviewed preference"));
    await waitFor(() => expect(api.savePreference).toHaveBeenCalledOnce());
    expect(api.savePreference).toHaveBeenCalledWith({
      expectedVersion: 4,
      defaultWorkspace: "fleet_my_day",
      selectedFleetId: null,
    });
  });
});
