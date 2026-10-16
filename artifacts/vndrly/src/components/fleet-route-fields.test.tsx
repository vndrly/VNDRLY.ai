import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FleetRouteFields } from "./fleet-route-fields";
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
const location = (id: string, name: string) => ({
  id,
  revision: 1,
  name,
  kind: "pickup" as const,
  address: name,
  latitude: null,
  longitude: null,
  materials: [],
  hours: "",
  instructions: "",
  active: true,
  ownerType: "vendor" as const,
  ownerId: 7,
});
const origin = location("11111111-1111-4111-8111-111111111111", "Lease tank"),
  drop = location(
    "22222222-2222-4222-8222-222222222222",
    "Collection terminal",
  ),
  base = location("33333333-3333-4333-8333-333333333333", "Yard");
it("selects physical locations without filling or changing billing fields and adds explicit cycles and return", () => {
  const change = vi.fn();
  render(
    <FleetRouteFields
      value={null}
      destinations={[origin, drop, base]}
      onChange={change}
    />,
  );
  fireEvent.change(screen.getByLabelText("Origin"), {
    target: { value: origin.id },
  });
  expect(change).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: drop.id },
  });
  expect(change.mock.calls.at(-1)?.[0]).toMatchObject({
    origin: { type: "canonical", location: { id: origin.id } },
    returnPolicy: "delivery_only",
    base: null,
    plannedWindow: null,
  });
  expect(change.mock.calls.at(-1)?.[0]).not.toHaveProperty("billingSiteId");
  fireEvent.click(
    screen.getByRole("button", { name: "Repeat pickup / delivery cycle" }),
  );
  fireEvent.change(screen.getByLabelText("Return policy"), {
    target: { value: "return_required" },
  });
  expect(change).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByLabelText("Return base"), {
    target: { value: base.id },
  });
  const plan = change.mock.calls.at(-1)?.[0];
  expect(plan.stops.map((stop: any) => stop.kind)).toEqual([
    "delivery",
    "pickup",
    "delivery",
    "return",
  ]);
  expect(new Set(plan.stops.map((stop: any) => stop.id)).size).toBe(4);
  expect(plan.base.location.id).toBe(base.id);
  expect(plan.stops.at(-1).location.location.id).toBe(base.id);
});
