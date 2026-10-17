import React from "react";
import FleetRunOrderChoice from "./FleetRunOrderChoice";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), current: true }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => mocks.current,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "white", card: "grey", primary: "gold" }),
}));
vi.mock("@/lib/fleet-copy", () => ({
  useFleetCopy: () => (text: string) => text,
}));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, options, onChange, disabled }: any) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose</option>
      {options.map((item: any) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const location = (n: number) => ({
  id: id(n),
  revision: 1,
  name: `Place ${n}`,
  kind: "pickup",
  address: `${n} Manual street`,
  latitude: null,
  longitude: null,
  ownerType: "vendor",
  ownerId: 7,
  active: true,
  materials: [],
  hours: "",
  instructions: "",
});
const order = {
  id: id(1),
  companyId: 7,
  version: 1,
  name: "Tank to collection",
  accessGroupIds: [id(2)],
  origin: location(3),
  destination: location(4),
  base: null,
  returnPolicy: "delivery_only",
  instructions: "Haul crude",
  timeZone: "America/Chicago",
  archivedAt: null,
};
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
  mocks.current = true;
});
it("selects the current saved Run without assigning a driver or creating a ticket", async () => {
  const Choice = FleetRunOrderChoice,
    onChange = vi.fn();
  mocks.api.mockImplementation(async (path: string) =>
    path === "/api/fleet/run-orders"
      ? { orders: [order], nextCursor: null, canManage: true }
      : order,
  );
  render(
    <Choice
      companyId={7}
      groupId={id(2)}
      disabled={false}
      onChange={onChange}
    />,
  );
  await screen.findByRole("option", { name: /Tank to collection/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: order.id },
  });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(order));
  expect(mocks.api.mock.calls.every((call) => !call[1]?.method)).toBe(true);
});
it("rejects a changed Run revision and late account results", async () => {
  const Choice = FleetRunOrderChoice,
    onChange = vi.fn();
  let resolve: ((value: unknown) => void) | undefined;
  mocks.api.mockImplementation((path: string) =>
    path === "/api/fleet/run-orders"
      ? Promise.resolve({ orders: [order], nextCursor: null, canManage: true })
      : Promise.resolve({ ...order, version: 2 }),
  );
  const view = render(
    <Choice
      companyId={7}
      groupId={id(2)}
      disabled={false}
      onChange={onChange}
    />,
  );
  await screen.findByRole("option", { name: /Tank to collection/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: order.id },
  });
  await screen.findByText(
    "This Run changed or is unavailable. Reload and choose it again.",
  );
  expect(onChange.mock.calls.some((call) => call[0] !== null)).toBe(false);
  view.unmount();
  mocks.api.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <Choice
      companyId={7}
      groupId={id(2)}
      disabled={false}
      onChange={onChange}
    />,
  );
  mocks.current = false;
  await act(async () => {
    resolve!({ orders: [order], nextCursor: null, canManage: true });
  });
  expect(
    screen.queryByRole("option", { name: /Tank to collection/ }),
  ).toBeNull();
});
