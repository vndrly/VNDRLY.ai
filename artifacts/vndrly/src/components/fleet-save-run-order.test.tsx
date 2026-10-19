import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { FleetSaveRunOrder } from "./fleet-save-run-order";
import { it, expect, vi, afterEach } from "vitest";
import { FleetRunOrderSchema, fleetRunOrderRoute } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  saveRunOrder: vi.fn(),
  runOrderReceipt: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("updates the same Run revision and preserves all existing resource scopes", async () => {
  const id = () => crypto.randomUUID(),
    group = id(),
    otherGroup = id(),
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
    version: 4,
    name: "Original Run",
    accessGroupIds: [group, otherGroup],
    origin: place("Tank"),
    destination: place("Terminal"),
    base: null,
    returnPolicy: "delivery_only",
    instructions: "Existing instructions",
    timeZone: "America/Chicago",
    archivedAt: null,
  });
  let body: any;
  api.saveRunOrder.mockImplementation(async (input) => {
    body = input;
    return input.order;
  });
  api.runOrderReceipt.mockImplementation(async () => ({
    operationId: body.operationId,
    fingerprint: "a".repeat(64),
    order: body.order,
  }));
  const saved = vi.fn();
  render(
    <FleetSaveRunOrder
      identity="account-7"
      companyId={7}
      groupId={group}
      initialOrder={order}
      route={fleetRunOrderRoute(order, id)}
      timeZone="America/Chicago"
      disabled={false}
      onPending={() => {}}
      onSaved={saved}
    />,
  );
  fireEvent.change(screen.getByLabelText("Saved Run name"), {
    target: { value: "Revised Run" },
  });
  fireEvent.change(screen.getByLabelText("Run instructions"), {
    target: { value: "Updated transport instructions" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Run changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(body).toMatchObject({
    expectedVersion: 4,
    order: {
      id: order.id,
      version: 5,
      name: "Revised Run",
      accessGroupIds: [group, otherGroup],
      instructions: "Updated transport instructions",
    },
  });
  expect(order.version).toBe(4);
});
it("saves a reusable order with canonical readback and retries the exact operation after an uncertain response", async () => {
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
  let body: any;
  api.saveRunOrder.mockImplementation(async (input) => {
    body = input;
    return input.order;
  });
  api.runOrderReceipt
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockImplementation(async () => ({
      operationId: body.operationId,
      fingerprint: "a".repeat(64),
      order: body.order,
    }));
  const saved = vi.fn(),
    pending = vi.fn();
  render(
    <Save
      identity="account-7"
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
  fireEvent.click(
    screen.getByRole("button", { name: "Retry saving this Run" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(body.order));
  expect(api.saveRunOrder.mock.calls[0][0]).toEqual(
    api.saveRunOrder.mock.calls[1][0],
  );
  expect(body.order).not.toHaveProperty("ticketId");
  expect(pending).toHaveBeenLastCalledWith(false);
});
