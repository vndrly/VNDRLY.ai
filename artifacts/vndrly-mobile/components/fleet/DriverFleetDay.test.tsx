import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FleetHomeProjection } from "@workspace/api-zod";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#222", primary: "#0af", text: "white", mutedForeground: "#aaa", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/hooks/use-fleet-home", () => ({ useFleetHome: () => ({ projection: null, state: "loading", error: null, retry: vi.fn() }) }));
vi.mock("@/components/FleetLegacyWorkspace", () => ({ default: ({ initialMode, initialRunId }: { initialMode: string; initialRunId?: string }) => <div>{`run-workspace:${initialMode}:${initialRunId ?? "all"}`}</div> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));

import DriverFleetDay from "./DriverFleetDay";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const projection = (capabilities: FleetHomeProjection["capabilities"], nextAction: FleetHomeProjection["nextAction"] = null): FleetHomeProjection => ({
  companyId: 11, userId: 42, mode: "my_fleet_day", capabilities, nextAction, priorities: [], warnings: [], moduleStates: [],
});

afterEach(cleanup);

it("keeps the canonical assigned-run workspace as the driver's one primary workflow", () => {
  render(<DriverFleetDay projection={projection(["driver"])} initialRunId={id(1)} onOpenYard={vi.fn()} />);
  expect(screen.getByText(`run-workspace:my-day:${id(1)}`)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open assigned Yard Order" })).toBeNull();
});

it("keeps a Yard follow-up secondary while an active run is the canonical next action", () => {
  const open = vi.fn();
  const yard = { kind: "report_yard_order" as const, label: "Complete Yard hookup", runId: id(1), yardOrderId: id(2) };
  render(<DriverFleetDay projection={{ ...projection(["driver", "yard"], { kind: "start_run", label: "Start assigned run", runId: id(1) }), priorities: [yard] }} onOpenYard={open} />);
  expect(screen.queryByRole("button", { name: "Open assigned Yard Order" })).toBeNull();
  expect(screen.getByText(`run-workspace:my-day:${id(1)}`)).toBeTruthy();
});

it("makes the assigned Yard Order the sole primary action when the projection says it is next", () => {
  const open = vi.fn();
  const yard = { kind: "report_yard_order" as const, label: "Complete Yard hookup", runId: id(1), yardOrderId: id(2) };
  render(<DriverFleetDay projection={{ ...projection(["driver", "yard"], yard), priorities: [yard] }} onOpenYard={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Open assigned Yard Order" }));
  expect(open).toHaveBeenCalledWith(id(2), id(1));
  expect(screen.queryByText(`run-workspace:my-day:${id(1)}`)).toBeNull();
});

it("supports a self-dispatching independent without requiring Yard staff", () => {
  render(<DriverFleetDay projection={projection(["driver", "self_dispatch"], { kind: "start_run", label: "Start assigned run", runId: id(1) })} onOpenYard={vi.fn()} />);
  expect(screen.getByText("You can prepare and run your own work without a separate Yard or Dispatch handoff.")).toBeTruthy();
  expect(screen.getByText(`run-workspace:my-day:${id(1)}`)).toBeTruthy();
});

it("keeps warnings advisory and the run workspace available", () => {
  const value = { ...projection(["driver"]), warnings: [{ id: id(9), message: "Vehicle inspection needs attention" }] };
  render(<DriverFleetDay projection={value} onOpenYard={vi.fn()} />);
  expect(screen.getByRole("alert").textContent).toContain("Vehicle inspection needs attention");
  expect(screen.getByText("Warnings affect the Fleet score but do not stop ticket work.")).toBeTruthy();
  expect(screen.getByText("run-workspace:my-day:all")).toBeTruthy();
});
