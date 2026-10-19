import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  auth: {
    user: { id: 1 },
    activeMembershipId: 10,
    activeMembership: { orgType: "vendor", orgId: 20 },
  },
  uuid: vi.fn(() => "10000000-0000-4000-8000-000000000001"),
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#123", text: "#fff", background: "#000" }),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ key: mocks.auth.activeMembershipId }),
  isAuthScopeCurrent: (scope: any) =>
    scope.key === mocks.auth.activeMembershipId,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
import FleetTicketPlan from "./FleetTicketPlan";
import FleetDestinationDirectory from "./FleetDestinationDirectory";
const destination = {
  id: "20000000-0000-4000-8000-000000000001",
  revision: 1,
  name: "Disposal Alpha",
  kind: "disposal",
  address: "123 Yard",
  latitude: 35,
  longitude: -97,
  materials: ["water"],
  hours: "All day",
  instructions: "Call ahead",
  active: true,
  ownerType: "vendor",
  ownerId: 20,
};
const context = {
  version: 3,
  defaultMode: "batch",
  destinations: [destination],
  sitePolicy: null,
  canManage: true,
  sites: [{ siteId: 7, name: "Origin Alpha" }],
};
beforeEach(() => {
  mocks.auth.activeMembershipId = 10;
  mocks.api.mockImplementation((path: string, options: any) => {
    if (options?.method === "POST")
      return Promise.reject(new Error("Network interrupted"));
    return Promise.resolve(
      path.includes("/tickets/")
        ? {
            ticketId: 8,
            siteId: 7,
            partnerId: 4,
            plan: null,
            charges: { runs: 0, total: 0 },
            canManage: true,
          }
        : context,
    );
  });
});
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
  mocks.uuid.mockClear();
});
it("reviews an address-only location without fabricating zero coordinates", async () => {
  render(<FleetDestinationDirectory />);
  await screen.findByRole("button", { name: "Edit Disposal Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Add destination" }));
  fireEvent.change(screen.getByLabelText("name"), {
    target: { value: "Temporary lease pickup" },
  });
  fireEvent.change(screen.getByLabelText("address"), {
    target: { value: "West gate road" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review destination" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm destination" }),
  );
  await screen.findAllByText("Network interrupted");
  const post = mocks.api.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(JSON.parse(post[1].body).destination).toMatchObject({
    latitude: null,
    longitude: null,
    address: "West gate road",
  });
});
it("requires review and confirmation and retries the identical ticket payload", async () => {
  render(<FleetTicketPlan ticketId={8} />);
  await screen.findByText("Origin: Origin Alpha (locked)");
  fireEvent.change(screen.getByLabelText("Dollars per run"), {
    target: { value: "125.50" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Disposal Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Review ticket plan" }));
  expect(
    mocks.api.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm ticket plan" }));
  await screen.findByText("Network interrupted");
  fireEvent.click(screen.getByRole("button", { name: "Confirm ticket plan" }));
  await waitFor(() =>
    expect(
      mocks.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(2),
  );
  const calls = mocks.api.mock.calls.filter((c) => c[1]?.method === "POST");
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({
    expectedVersion: 0,
    mode: "batch",
    rateCents: 12550,
    destinationIds: [destination.id],
  });
  expect(mocks.uuid).toHaveBeenCalledTimes(1);
});
it("discards a ticket draft immediately after company switch", async () => {
  const view = render(<FleetTicketPlan ticketId={8} />);
  await screen.findByLabelText("Dollars per run");
  fireEvent.change(screen.getByLabelText("Dollars per run"), {
    target: { value: "999" },
  });
  mocks.auth.activeMembershipId = 11;
  view.rerender(<FleetTicketPlan ticketId={8} />);
  expect(screen.queryByDisplayValue("999")).toBeNull();
  await screen.findByLabelText("Dollars per run");
  expect(screen.queryByDisplayValue("999")).toBeNull();
});
it("directory search and destination edit require exact confirmation before saving", async () => {
  render(<FleetDestinationDirectory />);
  await screen.findByRole("button", { name: "Edit Disposal Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Edit Disposal Alpha" }));
  fireEvent.change(screen.getByLabelText("name"), {
    target: { value: "Disposal Beta" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review destination" }));
  expect(
    mocks.api.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm destination" }));
  await screen.findAllByText("Network interrupted");
  const call = mocks.api.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedVersion: 3,
    destination: { id: destination.id, name: "Disposal Beta", latitude: 35 },
  });
  expect(JSON.parse(call[1].body).destination.ownerId).toBeUndefined();
});
it("rejects timed closure without a future date and applies partner mode", async () => {
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("/tickets/")
        ? {
            ticketId: 8,
            siteId: 7,
            partnerId: 4,
            plan: null,
            charges: { runs: 0, total: 0 },
            canManage: true,
          }
        : { ...context, sitePolicy: { mode: "singles" } },
    ),
  );
  render(<FleetTicketPlan ticketId={8} />);
  await screen.findByText("Partner override: singles");
  fireEvent.change(screen.getByLabelText("Dollars per run"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Disposal Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Close shift" }));
  fireEvent.click(screen.getByRole("button", { name: "Review ticket plan" }));
  expect(
    await screen.findByText(
      "Enter a future closure date and time (YYYY-MM-DDTHH:mm).",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Confirm ticket plan" }),
  ).toBeNull();
});
it("shows frozen destinations and dollars total without presenting edits", async () => {
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("/tickets/")
        ? {
            ticketId: 8,
            siteId: 7,
            partnerId: 4,
            plan: {
              version: 1,
              mode: "batch",
              rateCents: 2000,
              closure: "manual",
              closesAt: null,
              destinations: [destination],
            },
            charges: { runs: 2, total: "40.00" },
            canManage: true,
          }
        : context,
    ),
  );
  render(<FleetTicketPlan ticketId={8} />);
  expect(
    await screen.findByText("Accepted runs: 2 · Total: $40.00"),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Dollars per run")).toBeNull();
});
it("preserves recommendation order and distance basis and requires explicit destination approval", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, options: any) =>
    path.includes("/destinations/recommend")
      ? Promise.resolve({
          recommendations: [
            {
              destination,
              distanceMiles: 12.2,
              durationMinutes: null,
              basis: "straight_line",
              availability: "capacity_unconfirmed",
              materialEligibility: "matched",
            },
          ],
        })
      : original(path, options),
  );
  render(<FleetTicketPlan ticketId={8} />);
  await screen.findByLabelText("Dollars per run");
  fireEvent.change(
    screen.getByLabelText("Material for destination suggestions"),
    { target: { value: "water" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Find destination suggestions" }),
  );
  expect(
    await screen.findByText(
      "1. Disposal Alpha · Straight-line distance: 12.2 mi",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText("Capacity unconfirmed · Material matched · All day"),
  ).toBeTruthy();
  expect(
    mocks.api.mock.calls.some(
      (c) =>
        c[0] === "/api/fleet/destinations/recommend?siteId=7&material=water",
    ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Dollars per run"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review ticket plan" }));
  expect(
    await screen.findByText("Select at least one approved destination."),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve suggestion: Disposal Alpha" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review ticket plan" }));
  expect(
    screen.getByRole("button", { name: "Confirm ticket plan" }),
  ).toBeTruthy();
  expect(
    mocks.api.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
});
