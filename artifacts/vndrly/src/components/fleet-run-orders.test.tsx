import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetRunOrders } from "./fleet-run-orders";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { FleetRunOrderSchema } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  runOrders: vi.fn(),
  runOrder: vi.fn(),
  commercial: vi.fn(),
  saveRunOrder: vi.fn(),
  runOrderReceipt: vi.fn(),
  runOrderHistory: vi.fn(),
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
it("manages reusable Runs and their revision history independently of tickets and activity records", async () => {
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
  api.runOrders.mockImplementation(async () => ({
    orders: [current],
    nextCursor: null,
    canManage: true,
  }));
  api.runOrder.mockImplementation(async () => current);
  api.commercial.mockResolvedValue({
    version: 1,
    defaultMode: "batch",
    destinations: [original.origin, original.destination],
    canManage: true,
    sites: [],
    sitePolicy: null,
  });
  api.saveRunOrder.mockImplementation(async (input) => {
    body = input;
    current = input.order;
    return current;
  });
  api.runOrderReceipt.mockImplementation(async () => ({
    operationId: body.operationId,
    fingerprint: "a".repeat(64),
    order: current,
  }));
  api.runOrderHistory.mockImplementation(async () => ({
    records: [
      { id: 2, order: current },
      { id: 1, order: original },
    ],
    nextCursor: null,
  }));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Library
        identity="account-7"
        companyId={7}
        groups={[{ id: group, name: "Company resources" }]}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: /Original Run/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: original.id },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit selected Run" }),
  );
  fireEvent.change(screen.getByLabelText("Saved Run name"), {
    target: { value: "Revised Run" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Run changes" }));
  await waitFor(() => expect(api.saveRunOrder).toHaveBeenCalled());
  await screen.findByRole("option", { name: /Revised Run/ });
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: original.id },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Run revision history" }),
  );
  await screen.findByText(/Revision 4.*Original Run/);
  expect(screen.getByText(/Revision 5.*Revised Run/)).toBeTruthy();
  expect(body.order).not.toHaveProperty("linkedTicketId");
  expect(original.version).toBe(4);
});
