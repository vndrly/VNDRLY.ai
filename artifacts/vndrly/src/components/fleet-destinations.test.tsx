import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  commercial: vi.fn(),
  saveDestination: vi.fn(),
  back: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("@/lib/in-app-navigation", () => ({ navigateBackInApp: api.back }));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
import { FleetDestinationsPage } from "./fleet-destinations";
const destination = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: 2,
  name: "Lease pickup",
  kind: "pickup" as const,
  address: "West tank road",
  latitude: null,
  longitude: null,
  ownerType: "vendor" as const,
  ownerId: 7,
  materials: [],
  hours: "",
  instructions: "Call at gate",
  active: true,
};
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetDestinationsPage identity="1:7" />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  api.commercial.mockResolvedValue({
    version: 3,
    destinations: [destination],
    canManage: true,
    defaultMode: "batch",
    sitePolicy: null,
    sites: [],
  });
});
it("edits the same canonical location, allows a manual address and retries exact reviewed changes", async () => {
  api.saveDestination
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({
      version: 4,
      destination: { ...destination, revision: 3 },
    });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit Lease pickup" }),
  );
  fireEvent.change(screen.getByLabelText("Address"), {
    target: { value: "East tank road" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review location" }));
  expect(api.saveDestination).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save location" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Save location" }));
  await waitFor(() => expect(api.saveDestination).toHaveBeenCalledTimes(2));
  expect(api.saveDestination.mock.calls[0][0]).toMatchObject({
    expectedVersion: 3,
    destination: {
      id: destination.id,
      address: "East tank road",
      latitude: null,
      longitude: null,
    },
  });
  expect(api.saveDestination.mock.calls[1][0]).toEqual(
    api.saveDestination.mock.calls[0][0],
  );
});
it("uses branded history Back and retains read-only location access", async () => {
  api.commercial.mockResolvedValue({
    version: 3,
    destinations: [destination],
    canManage: false,
  });
  mount();
  await screen.findByText("Lease pickup");
  expect(screen.queryByRole("button", { name: "Add location" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(api.back).toHaveBeenCalledTimes(1);
});
