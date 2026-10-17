import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetRunOrderChoice } from "./fleet-run-order-choice";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({ runOrders: vi.fn(), runOrder: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
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
  vi.resetAllMocks();
});
it("reads the exact saved Run revision before returning the transport order to dispatch", async () => {
  const Choice = FleetRunOrderChoice,
    onChange = vi.fn();
  api.runOrders.mockResolvedValue({
    orders: [
      order,
      { ...order, id: id(8), name: "Other group", accessGroupIds: [id(9)] },
    ],
    nextCursor: null,
    canManage: true,
  });
  api.runOrder.mockResolvedValue(order);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Choice
        identity="account-7"
        companyId={7}
        groupId={id(2)}
        disabled={false}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: /Tank to collection/ });
  expect(screen.queryByRole("option", { name: /Other group/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Saved Run"), {
    target: { value: order.id },
  });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(order));
  expect(api.runOrder).toHaveBeenCalledWith(order.id);
});
