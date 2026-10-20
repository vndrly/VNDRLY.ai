import React from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FleetModuleBoundary from "./FleetModuleBoundary";

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: "#f90", destructive: "#f33" }),
}));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button>,
}));

afterEach(cleanup);

describe("FleetModuleBoundary", () => {
  it("shows only the affected module's conflict recovery and offers canonical review", () => {
    const onRetry = vi.fn();
    const onReview = vi.fn();
    render(
      <FleetModuleBoundary module="compliance" state="unavailable" error={{ status: 409, code: "fleet.conflict", recovery: { reloadCanonical: true, retainedWork: "unknown" } }} onRetry={onRetry} onReview={onReview}>
        <Text>Stale compliance content</Text>
      </FleetModuleBoundary>,
    );
    expect(screen.getByText(/Compliance changed/)).toBeTruthy();
    expect(screen.getByText(/Check whether your work was retained/)).toBeTruthy();
    expect(screen.queryByText("Stale compliance content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review current Compliance" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry Compliance" }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(["loading", "empty", "warning", "unavailable"] as const)("renders %s as its own module state", (state) => {
    render(<FleetModuleBoundary module="map" state={state} onRetry={() => undefined}><Text>Map content</Text></FleetModuleBoundary>);
    expect(screen.getByTestId("fleet-module-map")).toBeTruthy();
    expect(screen.getByText(new RegExp(state === "loading" ? "Loading Map" : state === "empty" ? "No Map" : state === "warning" ? "Map needs attention" : "Map is unavailable"))).toBeTruthy();
    expect(screen.queryByText("Map content") !== null).toBe(state === "warning");
  });

  it.each([
    ["retained", "Your saved work was retained."],
    ["not_retained", "Your work was not retained."],
  ] as const)("explains a %s conflict outcome without claiming completion", (retainedWork, message) => {
    render(<FleetModuleBoundary module="driver" state="unavailable" error={{ status: 409, recovery: { retainedWork } }} />);
    expect(screen.getByText(new RegExp(message.replaceAll(".", "\\.")))).toBeTruthy();
  });
});
