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
    expect(screen.getByRole("button", { name: "Open Fleet Setup" })).toBeTruthy();
  });

  it("lets an independent Admin explicitly expose eligible advanced cards while keeping one next action", () => {
    const projection = home(["admin", "office", "dispatch", "yard", "driver", "self_dispatch"], "my_fleet_day");
    render(<FleetHome projection={projection} visibility={{ dispatch: true, yard: true, map: true }} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open Dispatch Board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Yard Board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Fleet Map" })).toBeTruthy();
    expect(screen.getAllByText("Next action")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Start run" })).toHaveLength(1);
  });

  it.each([
    [{ kind: "report_yard_order", label: "Report Yard Order", yardOrderId: "22222222-2222-4222-8222-222222222222" }, undefined],
    [{ kind: "report_yard_order", label: "Report Yard Order", yardOrderId: "33333333-3333-4333-8333-333333333333", runId: action.runId }, action.runId],
    [{ kind: "report_yard_order", label: "Report Yard Order", yardOrderId: "44444444-4444-4444-8444-444444444444", runId: action.runId }, action.runId],
  ] as const)("passes the exact assigned Yard Order to navigation", (next, runId) => {
    const projection = home(["driver", "yard"], "my_fleet_day");
    projection.nextAction = next;
    const onOpen = vi.fn();
    render(<FleetHome projection={projection} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Report Yard Order" }));
    expect(onOpen).toHaveBeenCalledWith("yard", runId, next.yardOrderId);
  });

  it("surfaces an unavailable independent source with one Home retry and usable links", () => {
    const projection = home(["driver", "self_dispatch"], "my_fleet_day");
    projection.nextAction = null;
    projection.priorities = [];
    projection.moduleStates = projection.moduleStates.map(item => item.module === "history" ? { ...item, state: "unavailable" } : item);
    const onOpen = vi.fn();
    const onRetry = vi.fn();
    render(<FleetHome projection={projection} onOpen={onOpen} onRetry={onRetry} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getByText("Route and return unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry Fleet Home" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Ticket state" }));
    expect(onOpen).toHaveBeenCalledWith("driver");
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
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
