import { describe, expect, it } from "vitest";
import {
  completeRetrospectiveVisit,
  createMemoryStaleVisitRepository,
  listVisitsNeedingReview,
  matchVehicleByPlate,
  observeGateCrossing,
  reconcileStaleVisit,
  reconcileVisit,
  reverseVisitReconciliation,
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

  it("requires a reason and idempotently removes a stale visit from occupancy", async () => {
    const repository = createMemoryStaleVisitRepository([{
      id: 41,
      siteId: 10,
      checkOutTime: null,
      expiresAt: new Date("2026-09-22T08:00:00.000Z"),
      reconciliationState: "needs_review",
    }]);
    await expect(reconcileStaleVisit({
      visitId: 41,
      actorUserId: 7,
      allowedSiteIds: [10],
      reason: " ",
      idempotencyKey: "resolve-41",
    }, repository)).rejects.toMatchObject({ code: "gate.reason_required" });

    const first = await reconcileStaleVisit({
      visitId: 41,
      actorUserId: 7,
      allowedSiteIds: [10],
      reason: "Confirmed vehicle departed without being logged out",
      idempotencyKey: "resolve-41",
    }, repository);
    const retry = await reconcileStaleVisit({
      visitId: 41,
      actorUserId: 7,
      allowedSiteIds: [10],
      reason: "Confirmed vehicle departed without being logged out",
      idempotencyKey: "resolve-41",
    }, repository);
    expect(retry.id).toBe(first.id);
    expect(await listVisitsNeedingReview({ siteIds: [10] }, repository)).toEqual([]);
  });

  it("prevents cross-site resolution and restricts reversal to supervisors", async () => {
    const repository = createMemoryStaleVisitRepository([{
      id: 42,
      siteId: 11,
      checkOutTime: null,
      expiresAt: new Date("2026-09-22T08:00:00.000Z"),
      reconciliationState: "needs_review",
    }]);
    await expect(reconcileStaleVisit({
      visitId: 42,
      actorUserId: 7,
      allowedSiteIds: [10],
      reason: "Not on site",
      idempotencyKey: "resolve-42",
    }, repository)).rejects.toMatchObject({ code: "gate.visit_not_found" });

    const resolved = await reconcileStaleVisit({
      visitId: 42,
      actorUserId: 7,
      allowedSiteIds: [11],
      reason: "Not on site",
      idempotencyKey: "resolve-42-ok",
    }, repository);
    await expect(reverseVisitReconciliation({
      visitId: 42,
      reconciliationId: resolved.id,
      actorUserId: 7,
      allowedSiteIds: [11],
      supervisor: false,
      reason: "Vehicle remains on site",
      idempotencyKey: "reverse-42",
    }, repository)).rejects.toMatchObject({ code: "gate.supervisor_required" });
    await reverseVisitReconciliation({
      visitId: 42,
      reconciliationId: resolved.id,
      actorUserId: 8,
      allowedSiteIds: [11],
      supervisor: true,
      reason: "Vehicle remains on site",
      idempotencyKey: "reverse-42-ok",
    }, repository);
    expect(await listVisitsNeedingReview({ siteIds: [11] }, repository)).toHaveLength(1);
    expect(repository.events()).toHaveLength(2);
  });
});
