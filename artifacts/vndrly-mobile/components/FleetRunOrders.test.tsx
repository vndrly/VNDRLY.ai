import React from "react";
import FleetRunOrders from "./FleetRunOrders";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { FleetRunOrderSchema } from "@workspace/api-zod";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "grey",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("@/lib/fleet-copy", () => ({
  useFleetCopy: () => (text: string) => text,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
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
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("prepares and revises reusable Runs in the company library with canonical history readback", async () => {
  const Library = FleetRunOrders;
  const id = () => crypto.randomUUID(),
    group = id(),
    place = (name: string) => ({
      id: id(),
      revision: 1,
      name,
      kind: "pickup",
      address: name,
      latitude: null,
      longitude: null,
      ownerType: "vendor",
      ownerId: 7,
    });
  const original = FleetRunOrderSchema.parse({
    id: id(),
    companyId: 7,
    version: 4,
    name: "Original Run",
    accessGroupIds: [group],
    origin: place("Tank"),
    destination: place("Terminal"),
    base: null,
    returnPolicy: "delivery_only",
    instructions: "Existing instructions",
    timeZone: "America/Chicago",
    archivedAt: null,
  });
  let current = original,
    body: any;
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path === "/api/fleet/overview")
      return {
        companyId: 7,
        enabled: true,
        fleets: [{ id: group, name: "Company resources" }],
      };
    if (path === "/api/fleet/commercial")
      return {
        version: 1,
        defaultMode: "batch",
        destinations: [original.origin, original.destination],
        canManage: true,
        sites: [],
        sitePolicy: null,
      };
    if(path.endsWith("/locations"))return {orderId:original.id,orderVersion:original.version,locations:[{...original.origin,revision:2,address:"Moved tank entrance"},original.destination],unavailableLocationIds:[]};
    if (options?.method === "POST") {
      body = JSON.parse(options.body);
      current = body.order;
      return current;
    }
    if (path.includes("/operations/"))
      return {
        operationId: body.operationId,
        fingerprint: "a".repeat(64),
        order: current,
      };
    if (path.includes("/history"))
      return {
        records: [
          { id: 2, order: current },
          { id: 1, order: original },
        ],
        nextCursor: null,
      };
    if (path === "/api/fleet/run-orders")
      return { orders: [current], nextCursor: null, canManage: true };
    return current;
  });
  render(<Library companyId={7} />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/fleet/overview", {}, {}));
  await screen.findByRole("option", { name: /Original Run/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: original.id },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit selected Run" }),
  );
  fireEvent.click(screen.getByRole("button",{name:"Review current locations"}));
  await screen.findByText(/Moved tank entrance/);
  expect(body).toBeUndefined();
  expect((screen.getByRole("button",{name:"Save Run changes"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Use reviewed locations"}));
  fireEvent.change(screen.getByLabelText("Saved Run name"), {
    target: { value: "Revised Run" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Run changes" }));
  await screen.findByRole("option", { name: /Revised Run/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: original.id },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Run revision history" }),
  );
  await screen.findByText(/Revision 4.*Original Run/);
  expect(screen.getByText(/Revision 5.*Revised Run/)).toBeTruthy();
  expect(body).toMatchObject({
    expectedVersion: 4,
    order: { id: original.id, version: 5 },
  });
  expect(body.order).not.toHaveProperty("linkedTicketId");
  expect(body.order.origin).toMatchObject({revision:2,address:"Moved tank entrance"});
  expect(original.origin.revision).toBe(1);
  expect(original.version).toBe(4);
});
