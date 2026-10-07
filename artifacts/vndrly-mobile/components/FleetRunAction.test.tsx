import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetRunAction from "./FleetRunAction";
const run = { version: 3, currentStopId: null, stops: [], loads: [] } as unknown as FleetRun;
afterEach(cleanup);
describe("Fleet reported workflow forms", () => {
  it("links only a selected existing ticket candidate", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="link_ticket" disabled={false} onSubmit={submit} tickets={[{ id: 77, siteId: 392, status: "submitted" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "link ticket" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ticket #77 · site 392 · submitted" }));
    fireEvent.click(screen.getByRole("button", { name: "link ticket" }));
    expect(submit).toHaveBeenCalledWith({ ticketId: 77 });
  });
  it("requires explicit meter units and records the supplied reading without inventing mileage", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="record_meter" disabled={false} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("record_meter reading"), { target: { value: "8100" } });
    fireEvent.change(screen.getByLabelText("record_meter notes"), { target: { value: "Truck odometer at pickup" } });
    fireEvent.click(screen.getByRole("button", { name: "record meter" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "miles" }));
    fireEvent.click(screen.getByRole("button", { name: "record meter" }));
    expect(submit).toHaveBeenCalledWith({ reading: 8100, notes: "Truck odometer at pickup", unit: "miles" });
  });
  it("requires inspection notes and defaults to reporting a defect", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="inspect" disabled={false} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("inspect notes"), { target: { value: "Brake warning light" } });
    fireEvent.click(screen.getByRole("button", { name: "inspect" }));
    expect(submit).toHaveBeenCalledWith({ notes: "Brake warning light", inspectionOutcome: "defect_reported" });
  });
  it("records a supplied load reference and quantity without location or media claims", () => {
    const submit = vi.fn();
    render(<FleetRunAction run={run} action="record_load" disabled={false} onSubmit={submit} />);
    for (const [field, value] of Object.entries({ commodity: "Water", quantity: "12", unit: "bbl", manifestReference: "MAN-2" })) fireEvent.change(screen.getByLabelText(`record_load ${field}`), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "record load" }));
    expect(submit).toHaveBeenCalledWith({ commodity: "Water", quantity: 12, unit: "bbl", manifestReference: "MAN-2", loadId: "10000000-0000-4000-8000-000000000001" });
    expect(screen.getByText(/No device location/)).toBeTruthy();
  });
});
