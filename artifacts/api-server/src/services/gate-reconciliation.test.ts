import { describe, expect, it } from "vitest";
import {
  completeRetrospectiveVisit,
  matchVehicleByPlate,
  observeGateCrossing,
  reconcileVisit,
} from "./gate-reconciliation";
import { createAssetService, createMemoryAssetRepository } from "./assets";

describe("Gate reconciliation", () => {
  it("keeps the observed crossing time separate from information supplied later", () => {
    const observedAt = new Date("2026-09-13T12:00:00.000Z");
    const completedAt = new Date("2026-09-13T12:15:00.000Z");
    const observed = observeGateCrossing({ direction: "entry", at: observedAt, source: "camera", plate: "ABC123", plateState: "TX" });
    const reconciled = completeRetrospectiveVisit(observed, { driverName: "Pat Driver", company: "Joe's Concrete" }, { at: completedAt, gatekeeperUserId: 7 });
    expect(reconciled.observedArrivalAt).toEqual(observedAt);
    expect(reconciled.completedAt).toEqual(completedAt);
    expect(reconciled.facts.driverName.source).toBe("supplied_later");
  });

  it("routes unresolved identity and conflicting supplied facts to supervisor review", () => {
    const observed = observeGateCrossing({ direction: "entry", at: new Date(), source: "gatekeeper", plate: "ABC123", plateState: "TX" });
    expect(reconcileVisit(observed, { plate: "XYZ999", plateState: "TX" })).toMatchObject({ state: "needs_supervisor_review", conflictReason: "gate.conflicting_vehicle_identity" });
    expect(reconcileVisit(observeGateCrossing({ direction: "entry", at: new Date(), source: "camera" }), {})).toMatchObject({ state: "needs_supervisor_review" });
  });

  it("matches known plates and creates a provisional vehicle for a first-seen plate", async () => {
    const assets = createAssetService(createMemoryAssetRepository());
    const first = await matchVehicleByPlate({ plate: "ABC-123", plateState: "TX", owner: { type: "vendor", id: 1 }, assets });
    const again = await matchVehicleByPlate({ plate: "ABC123", plateState: "tx", owner: { type: "vendor", id: 1 }, assets });
    expect(first.provisional).toBe(true);
    expect(again.id).toBe(first.id);
  });
});
