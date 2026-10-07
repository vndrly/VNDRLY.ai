import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FleetActionInput, FleetRun } from "@workspace/api-zod";
import { FleetActionFields, fleetActionComplete } from "./fleet-action-fields";
const input = { operationId: "op", expectedVersion: 1 };
describe("Fleet hauling forms", () => {
  it("requires explicit meter units and notes, accepts reported zero and rejects fuel zero", () => {
    expect(
      fleetActionComplete({
        ...input,
        action: "record_meter",
        reading: 0,
        unit: "miles",
        notes: "Opening reading",
      }),
    ).toBe(true);
    expect(
      fleetActionComplete({
        ...input,
        action: "record_meter",
        reading: 20,
        unit: "gallons",
        notes: "Wrong unit",
      }),
    ).toBe(false);
    expect(
      fleetActionComplete({
        ...input,
        action: "record_fuel",
        quantity: 0,
        unit: "gallons",
        notes: "Fuel",
      }),
    ).toBe(false);
    expect(
      fleetActionComplete({ ...input, action: "pause", reason: " " }),
    ).toBe(false);
    expect(
      fleetActionComplete({ ...input, action: "link_ticket", ticketId: 5.5 }),
    ).toBe(false);
  });
  it("requires inspection outcome and notes before saving a driver report", () => {
    expect(
      fleetActionComplete({
        ...input,
        action: "inspect",
        inspectionOutcome: "passed",
      }),
    ).toBe(false);
    expect(
      fleetActionComplete({
        ...input,
        action: "inspect",
        inspectionOutcome: "passed",
        notes: "Walkaround completed",
      }),
    ).toBe(true);
  });
  it("requires finite positive quantities and manifest references", () => {
    const load: FleetActionInput = {
      ...input,
      action: "record_load",
      commodity: "Water",
      quantity: Infinity,
      unit: "bbl",
      manifestReference: "M-1",
    };
    expect(fleetActionComplete(load)).toBe(false);
    expect(fleetActionComplete({ ...load, quantity: 50 })).toBe(true);
    expect(
      fleetActionComplete({ ...load, quantity: 50, manifestReference: " " }),
    ).toBe(false);
  });
  it("offers only undelivered saved loads for delivery reporting", () => {
    const change = vi.fn();
    const run = {
      loads: [
        {
          id: "open",
          commodity: "Water",
          quantity: 50,
          unit: "bbl",
          manifestReference: "M-1",
          deliveredAt: null,
        },
        {
          id: "closed",
          commodity: "Oil",
          quantity: 20,
          unit: "bbl",
          manifestReference: "M-2",
          deliveredAt: "yesterday",
        },
      ],
    } as FleetRun;
    render(
      <FleetActionFields
        run={run}
        input={{ ...input, action: "record_delivery" }}
        onChange={change}
        disabled={false}
      />,
    );
    expect(screen.queryByText(/M-2/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Load"), {
      target: { value: "open" },
    });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({ loadId: "open", action: "record_delivery" }),
    );
  });
  it("requires an operational closeout decision and reason", () => {
    expect(
      fleetActionComplete({ ...input, action: "review", decision: "accept" }),
    ).toBe(false);
    expect(
      fleetActionComplete({
        ...input,
        action: "review",
        decision: "return",
        reason: "Correct the manifest",
      }),
    ).toBe(true);
  });
});
