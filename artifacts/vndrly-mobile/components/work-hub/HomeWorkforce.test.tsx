import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 2 }, activeMembershipId: 3 }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "#00bcd4" }) }));
vi.mock("@/components/gate/GateChrome", () => ({ useGateCopy: () => (en: string) => en }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/components/ModalDraft", () => ({ ModalPressable: ({ children, accessibilityLabel, accessibilityState, onPress }: any) => <button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button> }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey.includes("workforce-gaps")
  ? { data: [{ id: "gap-1", shiftTitle: "North gate shift", assignedCount: 1, requiredCount: 2 }] }
  : { data: { employees: [{ userId: 5, name: "Alex Field", onShift: true, onCall: "active", assignment: "North gate shift" }] } } }));

import HomeWorkforce from "./HomeWorkforce";

it("expands Shifts rows into lists without collapsing the card", () => {
  render(<HomeWorkforce />);
  expect(screen.queryByRole("button", { name: "Shifts" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Coverage Gaps" }));
  expect(screen.getByText("North gate shift")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Coverage Gaps" }));
  expect(screen.queryByText("1 / 2 assigned")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "On Shift Now" }));
  expect(screen.getByText("Alex Field")).toBeTruthy();
});
