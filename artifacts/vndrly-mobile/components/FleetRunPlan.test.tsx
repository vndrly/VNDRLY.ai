import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import FleetRunPlan, { createFleetRunFromPlan } from "./FleetRunPlan";
const mocks = vi.hoisted(() => ({ api: vi.fn(), current: true }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => mocks.current,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "gray",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./FleetRunOrderChoice", () => ({
  default: ({ onChange }: any) => (
    <button
      onClick={() =>
        onChange({
          id: "99999999-9999-4999-8999-999999999999",
          companyId: 7,
          version: 3,
          name: "Saved tank Run",
          accessGroupIds: [group],
          origin,
          destination: drop,
          base: null,
          returnPolicy: "delivery_only",
          instructions: "Haul crude",
          timeZone: "America/Chicago",
          archivedAt: null,
        })
      }
    >
      Choose saved tank Run
    </button>
  ),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/FleetChoiceField", () => ({
  default: ({ label, options, value, onChange, disabled }: any) => (
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose</option>
      {options.map((option: any) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
const group = "11111111-1111-4111-8111-111111111111",
  detailId = "22222222-2222-4222-8222-222222222222",
  truckId = "33333333-3333-4333-8333-333333333333";
const detail = {
  id: detailId,
  companyId: 7,
  version: 2,
  name: "Bob and Truck 12",
  vehicleAssetId: truckId,
  rigPackageId: null,
  rigPackageVersion: null,
  driverUserId: 9,
  accessGroupIds: [group],
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveUntil: null,
  archivedAt: null,
};
const snapshot = {
  detail,
  rigPackage: null,
  labels: {
    truck: "Truck 12",
    rigPackage: null,
    driver: "Bob Villa",
    components: [],
  },
  carrierOfRecordId: 7,
  snapshottedAt: "2026-10-16T12:00:00Z",
};
const place = (id: string, name: string) => ({
  id,
  revision: 1,
  name,
  address: name,
  latitude: null,
  longitude: null,
  kind: "pickup",
  active: true,
  ownerType: "vendor",
  ownerId: 7,
  materials: [],
  instructions: "",
  hours: "",
  timeZone: "America/Chicago",
});
const origin = place("44444444-4444-4444-8444-444444444444", "Lease tank"),
  drop = place("55555555-5555-4555-8555-555555555555", "Terminal");
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
  mocks.current = true;
});
it("matches a saved Run to the selected Detail and creates a separate ticket-bound activity", async () => {
  const change = vi.fn();
  mocks.api.mockImplementation(async (path: string) =>
    path === "/api/fleet/details"
      ? { details: [detail], nextCursor: null, canManage: true }
      : path === `/api/fleet/details/${detailId}`
        ? snapshot
        : {
            version: 1,
            defaultMode: "batch",
            destinations: [origin, drop],
            canManage: true,
            sitePolicy: null,
            sites: [{ siteId: 41, name: "Billing lease" }],
          },
  );
  render(
    <FleetRunPlan
      groupId={group}
      companyId={7}
      siteIds={[41]}
      disabled={false}
      onChange={change}
    />,
  );
  await screen.findByRole("option", { name: "Bob and Truck 12" });
  fireEvent.change(screen.getByLabelText("Saved Detail"), {
    target: { value: detailId },
  });
  await screen.findByText(/Bob Villa/);
  fireEvent.change(screen.getByLabelText("Billing site"), {
    target: { value: "41" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use saved Run" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose saved tank Run" }),
  );
  await waitFor(() =>
    expect(change.mock.calls.at(-1)?.[0]?.runOrder?.version).toBe(3),
  );
  const body = createFleetRunFromPlan({
    operationId: crypto.randomUUID(),
    originStopId: crypto.randomUUID(),
    fleetId: group,
    title: "Second crude delivery",
    plan: change.mock.calls.at(-1)![0],
    billing: {
      mode: "existing_ticket",
      ticketId: 88,
      afeNumber: "AFE-SYN",
      workDate: "2026-10-16",
    },
  });
  expect(body).toMatchObject({
    runOrderSelection: {
      id: "99999999-9999-4999-8999-999999999999",
      version: 3,
    },
    driverUserId: 9,
    billing: { mode: "existing_ticket", ticketId: 88 },
  });
  expect(body).not.toHaveProperty("runOrder");
});
it("combines an exact saved Detail, manual physical route and independent billing site without inventing driver actions", async () => {
  const change = vi.fn();
  mocks.api.mockImplementation(async (path: string) =>
    path === "/api/fleet/details"
      ? { details: [detail], nextCursor: null, canManage: true }
      : path === `/api/fleet/details/${detailId}`
        ? snapshot
        : path === "/api/fleet/commercial"
          ? {
              version: 1,
              defaultMode: "batch",
              destinations: [origin, drop],
              canManage: true,
              sitePolicy: null,
              sites: [
                { siteId: 41, name: "Billing lease" },
                { siteId: 99, name: "Outside group" },
              ],
            }
          : Promise.reject(new Error("Compliance lookup unavailable")),
  );
  const Component = FleetRunPlan;
  render(
    <Component
      groupId={group}
      companyId={7}
      siteIds={[41]}
      disabled={false}
      onChange={change}
    />,
  );
  await screen.findByRole("option", { name: "Bob and Truck 12" });
  expect(screen.queryByRole("option", { name: "Outside group" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Saved Detail"), {
    target: { value: detailId },
  });
  await screen.findByText(/Bob Villa/);
  fireEvent.change(screen.getByLabelText("Billing site"), {
    target: { value: "41" },
  });
  fireEvent.change(screen.getByLabelText("Origin"), {
    target: { value: origin.id },
  });
  fireEvent.change(screen.getByLabelText("Run time zone"), {
    target: { value: "America/Denver" },
  });
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: drop.id },
  });
  await waitFor(() => expect(change.mock.calls.at(-1)?.[0]).not.toBeNull());
  const body = createFleetRunFromPlan({
    operationId: crypto.randomUUID(),
    originStopId: crypto.randomUUID(),
    fleetId: group,
    title: "Deliver crude",
    plan: change.mock.calls.at(-1)![0],
    billing: {
      mode: "new_ticket",
      workTypeId: 8,
      afeNumber: "AFE-SYN",
      workDate: "2026-10-16",
    },
  });
  expect(body).toMatchObject({
    driverUserId: 9,
    vehicleAssetId: truckId,
    trailerAssetId: null,
    detailSelection: {
      version: 2,
      detailId,
      detailVersion: 2,
      timeZone: "America/Denver",
    },
    billing: { mode: "new_ticket" },
    stops: [
      { siteId: 41, destination: { id: origin.id, latitude: null } },
      { siteId: 41, destination: { id: drop.id, latitude: null } },
    ],
  });
  expect(body).not.toHaveProperty("acknowledged");
  expect(body).not.toHaveProperty("inspections");
  expect(body).not.toHaveProperty("start");
});
it("does not publish late resources after account scope changes", async () => {
  const releases: Array<(value: unknown) => void> = [];
  mocks.api.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(resolve);
      }),
  );
  const change = vi.fn(),
    Component = FleetRunPlan;
  const view = render(
    <Component
      groupId={group}
      companyId={7}
      siteIds={[41]}
      disabled={false}
      onChange={change}
    />,
  );
  mocks.current = false;
  await act(async () => {
    releases[0]({ details: [detail], nextCursor: null, canManage: true });
    releases[1]({
      version: 1,
      defaultMode: "batch",
      destinations: [origin, drop],
      canManage: true,
      sitePolicy: null,
      sites: [{ siteId: 41, name: "Billing lease" }],
    });
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Bob and Truck 12" }),
    ).toBeNull(),
  );
  view.unmount();
  expect(change.mock.calls.some((call) => call[0] !== null)).toBe(false);
});
