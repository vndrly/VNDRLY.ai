import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    primary: "gold",
    card: "gray",
    background: "black",
  }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
import FleetRouteFields from "./FleetRouteFields";
const place = (id: string, name: string) => ({
  id,
  revision: 1,
  name,
  address: name,
  latitude: null,
  longitude: null,
  kind: "pickup" as const,
  active: true,
  ownerType: "vendor" as const,
  ownerId: 7,
  materials: [],
  instructions: "",
  hours: "",
});
it("selects address-only native origins and destinations while leaving billing independent", async () => {
  const origin = place("11111111-1111-4111-8111-111111111111", "Lease tank"),
    drop = place("22222222-2222-4222-8222-222222222222", "Terminal"),
    change = vi.fn();
  render(
    <FleetRouteFields
      value={null}
      destinations={[origin, drop]}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Origin" }));
  fireEvent.click(await screen.findByRole("button", { name: "Lease tank" }));
  fireEvent.click(screen.getByRole("button", { name: "Destination" }));
  fireEvent.click(await screen.findByRole("button", { name: "Terminal" }));
  expect(change.mock.calls.at(-1)?.[0]).toMatchObject({
    origin: { type: "canonical", location: { id: origin.id, latitude: null } },
    stops: [
      {
        kind: "delivery",
        location: { type: "canonical", location: { id: drop.id } },
      },
    ],
    plannedWindow: null,
    returnPolicy: "delivery_only",
  });
  expect(change.mock.calls.at(-1)?.[0]).not.toHaveProperty("billingSiteId");
});
