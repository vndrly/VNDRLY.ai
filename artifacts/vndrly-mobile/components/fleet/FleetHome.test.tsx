import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetCapability, FleetHomeProjection } from "@workspace/api-zod";
import FleetHome from "./FleetHome";

const ui = vi.hoisted(() => ({ width: 390, brand: "#137c49" }));
vi.mock("@expo/vector-icons", () => ({ Feather: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> }));
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  useWindowDimensions: () => ({ width: ui.width, height: 800, scale: 1, fontScale: 1 }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: ui.brand, destructive: "#f33" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, accessibilityLabel }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button> }));

const action = { kind: "start_run" as const, label: "Start run", runId: "11111111-1111-4111-8111-111111111111" };
function home(capabilities: FleetCapability[], mode: FleetHomeProjection["mode"] = "coordinated"): FleetHomeProjection {
  return {
    companyId: 3, userId: 7, mode, capabilities,
    nextAction: action, priorities: [action], warnings: [],
    moduleStates: ["dispatch", "yard", "assets", "map", "history", "compliance"].map(module => ({ module: module as FleetHomeProjection["moduleStates"][number]["module"], state: "ready" as const })),
  };
}
afterEach(() => { cleanup(); ui.width = 390; ui.brand = "#137c49"; });

describe("Fleet Home", () => {
  it.each([
    [["admin"], ["Dispatch Board", "Yard Board", "Active Runs", "Office", "Fleet Setup"]],
    [["office"], ["Needs Attention", "Active Runs", "Office"]],
    [["dispatch"], ["Dispatch Board", "Yard Board", "Active Runs"]],
    [["yard"], ["Yard Board"]],
    [["driver"], ["My Fleet Day", "Active Runs"]],
    [["driver", "yard"], ["My Fleet Day", "Yard Board", "Active Runs"]],
  ] as [FleetCapability[], string[]][])("shows authorized cards for %j", (capabilities, expected) => {
    render(<FleetHome projection={home(capabilities)} onOpen={vi.fn()} />);
    for (const label of expected) expect(screen.getByRole("button", { name: `Open ${label}` })).toBeTruthy();
    if (!capabilities.includes("admin") && !capabilities.includes("dispatch")) expect(screen.queryByRole("button", { name: "Open Dispatch Board" })).toBeNull();
    if (!capabilities.includes("yard") && !capabilities.includes("admin") && !capabilities.includes("dispatch")) expect(screen.queryByRole("button", { name: "Open Yard Board" })).toBeNull();
  });

  it("collapses an independent operator to one primary next action without a second handoff", () => {
    const projection = home(["admin", "office", "dispatch", "yard", "driver", "self_dispatch"], "my_fleet_day");
    projection.priorities = [action, { kind: "report_yard_order", label: "Report Yard Order", yardOrderId: "22222222-2222-4222-8222-222222222222", runId: action.runId }];
    const onOpen = vi.fn();
    render(<FleetHome projection={projection} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(onOpen).toHaveBeenCalledWith("driver", action.runId);
    expect(screen.queryByRole("button", { name: "Report Yard Order" })).toBeNull();
    expect(screen.getByText("My Fleet Day")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Yard Board" })).toBeNull();
  });

  it("supports an independent operator without a yard", () => {
    render(<FleetHome projection={home(["driver", "self_dispatch"], "my_fleet_day")} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start run" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Yard Board" })).toBeNull();
  });

  it.each([[390, "column", "100%"], [1024, "row", "48%"]] as const)("lays out cards at %i pixels", (width, direction, cardWidth) => {
    ui.width = width;
    render(<FleetHome projection={home(["admin"])} onOpen={vi.fn()} />);
    expect(screen.getByTestId("fleet-home-cards").style.flexDirection).toBe(direction);
    const card = screen.getByTestId("fleet-home-dispatch");
    expect(card.style.width).toBe(cardWidth);
    expect(card.style.borderTopColor).toBe("rgb(19, 124, 73)");
  });

  it("keeps usable cards when one optional module fails", () => {
    const projection = home(["admin"]);
    projection.moduleStates = projection.moduleStates.map(value => value.module === "compliance" ? { ...value, state: "unavailable" } : value);
    const onOpen = vi.fn();
    render(<FleetHome projection={projection} onOpen={onOpen} />);
    expect(screen.getByText("Compliance unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Dispatch Board" }));
    expect(onOpen).toHaveBeenCalledWith("dispatch");
  });

  it("respects Admin Home visibility without removing Fleet Setup", () => {
    render(<FleetHome projection={home(["admin"])} visibility={{ map: false, dispatch: false }} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open Fleet Map" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Dispatch Board" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Fleet Setup" })).toBeTruthy();
  });
});
