import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { FleetActionInput, FleetRun } from "@workspace/api-zod";
import { FleetActionFields, fleetActionComplete } from "./fleet-action-fields";
const input = { operationId: "op", expectedVersion: 1 };
const baseRun = FleetRunSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  fleetId: "22222222-2222-4222-8222-222222222222",
  companyId: 7,
  title: "Synthetic hauling run",
  driverUserId: 8,
  vehicleAssetId: "33333333-3333-4333-8333-333333333333",
  trailerAssetId: null,
  siteIds: [9],
  status: "acknowledged",
  phase: null,
  version: 4,
  stops: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      siteId: 9,
      kind: "pickup",
      sequence: 0,
    },
  ],
  loads: [],
  inspections: [],
  currentStopId: null,
  visitedStopIds: [],
  events: [],
  linkedTicketId: null,
  allowedActions: ["inspect"],
});
describe("Fleet hauling forms", () => {
  it("renders actual saved checklist labels and omits not-applicable for required items", () => {
    const change = vi.fn();
    const run = {
      ...baseRun,
      operationalProfile: {
        name: "Saved profile",
        inspectionItems: [{ id: "brakes", label: "Brakes", required: true }],
        manifestFields: [],
      },
    } as FleetRun;
    render(
      <FleetActionFields
        run={run}
        input={{ ...input, action: "inspect" }}
        onChange={change}
        disabled={false}
      />,
    );
    const choice = screen.getByLabelText("Brakes");
    expect(choice.querySelector('option[value="not_applicable"]')).toBeNull();
    fireEvent.change(choice, { target: { value: "defect_reported" } });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        inspectionResponses: [{ id: "brakes", outcome: "defect_reported" }],
      }),
    );
  });
  it("requires configured inspection answers and manifest values while preserving profile-free runs", () => {
    const run = {
      operationalProfile: {
        name: "Hauling",
        inspectionItems: [{ id: "brakes", label: "Brakes", required: true }],
        manifestFields: [{ id: "seal", label: "Seal", required: true }],
      },
    } as FleetRun;
    const inspect: FleetActionInput = {
      ...input,
      action: "inspect",
      inspectionOutcome: "passed",
      notes: "Reported inspection",
    };
    expect(fleetActionComplete(inspect, run)).toBe(false);
    expect(
      fleetActionComplete(
        {
          ...inspect,
          inspectionResponses: [{ id: "brakes", outcome: "not_applicable" }],
        },
        run,
      ),
    ).toBe(false);
    expect(
      fleetActionComplete(
        {
          ...inspect,
          inspectionResponses: [{ id: "brakes", outcome: "defect_reported" }],
        },
        run,
      ),
    ).toBe(false);
    expect(
      fleetActionComplete(
        {
          ...inspect,
          inspectionResponses: [{ id: "brakes", outcome: "passed" }],
        },
        run,
      ),
    ).toBe(true);
    const load: FleetActionInput = {
      ...input,
      action: "record_load",
      commodity: "Water",
      quantity: 10,
      unit: "barrels",
      manifestReference: "M-7",
    };
    expect(fleetActionComplete(load, run)).toBe(false);
    expect(
      fleetActionComplete({ ...load, manifestValues: { seal: "S-7" } }, run),
    ).toBe(true);
    expect(fleetActionComplete(load)).toBe(true);
  });
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
