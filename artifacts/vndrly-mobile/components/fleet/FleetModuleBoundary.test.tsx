import React, { useEffect } from "react";
import { Text } from "react-native";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FleetModuleBoundary from "./FleetModuleBoundary";

vi.mock("@expo/vector-icons", () => ({ Feather: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: "#137c49", destructive: "#f33" }),
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
    expect(screen.getByTestId("fleet-module-card-map").style.borderTopWidth).toBe("2px");
    expect(screen.getByTestId("fleet-module-card-map").style.borderTopColor).toBe("rgb(19, 124, 73)");
  });

  it("retries a caught render failure with stable children without remounting sibling modules", async () => {
    let repaired = false;
    const onRetry = vi.fn(() => { repaired = true; });
    const siblingMount = vi.fn();
    function ThrowOnce() { if (!repaired) throw new Error("render failed"); return <Text>Compliance recovered</Text>; }
    function Sibling() { useEffect(() => { siblingMount(); }, []); return <Text>Map still mounted</Text>; }
    const stableChild = <ThrowOnce />;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      render(<>
        <FleetModuleBoundary module="compliance" onRetry={onRetry}>{stableChild}</FleetModuleBoundary>
        <FleetModuleBoundary module="map"><Sibling /></FleetModuleBoundary>
      </>);
      expect(screen.getByText("Compliance is unavailable")).toBeTruthy();
      expect(screen.getByText("Map still mounted")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry Compliance" }));
      await waitFor(() => expect(screen.getByText("Compliance recovered")).toBeTruthy());
      expect(onRetry).toHaveBeenCalledOnce();
      expect(siblingMount).toHaveBeenCalledOnce();
    } finally { errorLog.mockRestore(); }
  });

  it.each([
    ["retained", "Your saved work was retained."],
    ["not_retained", "Your work was not retained."],
  ] as const)("explains a %s conflict outcome without claiming completion", (retainedWork, message) => {
    render(<FleetModuleBoundary module="driver" state="unavailable" error={{ status: 409, recovery: { retainedWork } }} />);
    expect(screen.getByText(new RegExp(message.replaceAll(".", "\\.")))).toBeTruthy();
  });
});
