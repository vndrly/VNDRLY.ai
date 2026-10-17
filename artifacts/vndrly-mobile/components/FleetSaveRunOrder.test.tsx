import React from "react";
import FleetSaveRunOrder from "./FleetSaveRunOrder";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { fleetRunOrderRoute, FleetRunOrderSchema } from "@workspace/api-zod";
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
it("retains one exact transport-order request through lost readback and reports success only after its receipt", async () => {
  const Save = FleetSaveRunOrder;
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
  const order = FleetRunOrderSchema.parse({
    id: id(),
    companyId: 7,
    version: 1,
    name: "Tank to terminal",
    accessGroupIds: [group],
    origin: place("Tank"),
    destination: place("Terminal"),
    base: null,
    returnPolicy: "delivery_only",
    instructions: "Haul crude",
    timeZone: "America/Chicago",
    archivedAt: null,
  });
  let body: any,
    reads = 0;
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (options?.method === "POST") {
      body = JSON.parse(options.body);
      return body.order;
    }
    if (++reads === 1) throw new Error("Response unavailable");
    return {
      operationId: body.operationId,
      fingerprint: "a".repeat(64),
      order: body.order,
    };
  });
  const saved = vi.fn(),
    pending = vi.fn();
  render(
    <Save
      companyId={7}
      groupId={group}
      route={fleetRunOrderRoute(order, id)}
      timeZone="America/Chicago"
      initialName="Tank to terminal"
      disabled={false}
      onPending={pending}
      onSaved={saved}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save this route as a Run" }),
  );
  await screen.findByRole("button", { name: "Retry saving this Run" });
  expect(saved).not.toHaveBeenCalled();
  expect(pending).toHaveBeenLastCalledWith(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry saving this Run" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(body.order));
  const writes = mocks.api.mock.calls.filter(
    (call) => call[1]?.method === "POST",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0][1].body).toBe(writes[1][1].body);
  expect(body.order).not.toHaveProperty("driverUserId");
  expect(body.order).not.toHaveProperty("ticketId");
  expect(pending).toHaveBeenLastCalledWith(false);
});
