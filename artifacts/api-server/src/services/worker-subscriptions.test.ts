import { describe, expect, it } from "vitest";
import {
  createMemoryWorkerSubscriptionRepository,
  createWorkerSubscriptionService,
} from "./worker-subscriptions";

const now = new Date("2026-09-14T12:00:00.000Z");
const renewalAt = new Date("2026-10-01T00:00:00.000Z");

function setup() {
  const repository = createMemoryWorkerSubscriptionRepository();
  return { repository, service: createWorkerSubscriptionService(repository, () => now) };
}

describe("company-sponsored worker subscriptions", () => {
  it("previews the exact company charge without creating a seat", async () => {
    const { repository, service } = setup();
    expect(await service.previewSeatChange({
      payor: { type: "vendor", id: 22 }, workerUserId: 101,
      plan: "full_worker", monthlyPriceCents: 1299, renewalAt,
    })).toEqual({
      confirmationRequired: true,
      payor: { type: "vendor", id: 22 },
      plan: "full_worker", monthlyPriceCents: 1299, currency: "USD",
      renewalAt, resultingSeatCount: 1,
    });
    expect(await repository.listForPayor({ type: "vendor", id: 22 })).toEqual([]);
  });

  it("activates only after confirmation and preserves the price snapshot", async () => {
    const { service } = setup();
    expect(await service.activateSeat({
      payor: { type: "vendor", id: 22 }, workerUserId: 101,
      plan: "gate_only", monthlyPriceCents: 999, renewalAt, confirmed: false,
      auditActorUserId: 7,
    })).toEqual({ status: "blocked", code: "worker_subscription.confirmation_required" });
    const applied = await service.activateSeat({
      payor: { type: "vendor", id: 22 }, workerUserId: 101,
      plan: "gate_only", monthlyPriceCents: 999, renewalAt, confirmed: true,
      auditActorUserId: 7,
    });
    expect(applied).toMatchObject({ status: "applied", seat: { state: "active", monthlyPriceCents: 999, renews: true } });
  });

  it("pauses access now, stops billing at renewal, and retains identity", async () => {
    const { service } = setup();
    const activated = await service.activateSeat({ payor: { type: "vendor", id: 22 }, workerUserId: 101, plan: "full_worker", monthlyPriceCents: 1299, renewalAt, confirmed: true, auditActorUserId: 7 });
    if (activated.status !== "applied") throw new Error("seat not activated");
    expect(await service.pauseSeat(activated.seat.id, 7)).toMatchObject({
      state: "paused", accessEndsAt: now, billingEndsAt: renewalAt, renews: false,
      workerUserId: 101,
    });
  });

  it("terminates without deleting history and reactivates the same seat", async () => {
    const { service } = setup();
    const activated = await service.activateSeat({ payor: { type: "vendor", id: 22 }, workerUserId: 101, plan: "full_worker", monthlyPriceCents: 1299, renewalAt, confirmed: true, auditActorUserId: 7 });
    if (activated.status !== "applied") throw new Error("seat not activated");
    const terminated = await service.terminateSeat(activated.seat.id, 7);
    expect(terminated).toMatchObject({ state: "terminated", accessEndsAt: now, renews: false, archivedAt: now });
    const reactivated = await service.reactivateSeat(activated.seat.id, { renewalAt: new Date("2026-11-01T00:00:00.000Z"), auditActorUserId: 7 });
    expect(reactivated).toMatchObject({ id: activated.seat.id, workerUserId: 101, state: "active", accessEndsAt: null, renews: true, archivedAt: null });
  });

  it("resolves full, gate-only, preview, and founding-site entitlements", async () => {
    const { service } = setup();
    const full = await service.activateSeat({ payor: { type: "vendor", id: 22 }, workerUserId: 101, plan: "full_worker", monthlyPriceCents: 1299, renewalAt, confirmed: true, auditActorUserId: 7 });
    const gate = await service.activateSeat({ payor: { type: "vendor", id: 22 }, workerUserId: 102, plan: "gate_only", monthlyPriceCents: 999, renewalAt, confirmed: true, auditActorUserId: 7, previewAccess: true, foundingSiteLocationId: 44 });
    if (full.status !== "applied" || gate.status !== "applied") throw new Error("seat not activated");
    expect(service.resolveEntitlement(full.seat, { module: "inventory", siteLocationId: 99 })).toMatchObject({ allowed: true, mode: "live" });
    expect(service.resolveEntitlement(gate.seat, { module: "gate", siteLocationId: 44 })).toMatchObject({ allowed: true, mode: "live" });
    expect(service.resolveEntitlement(gate.seat, { module: "work_hub", siteLocationId: 44 })).toMatchObject({ allowed: true, mode: "live" });
    expect(service.resolveEntitlement(gate.seat, { module: "inventory", siteLocationId: 44 })).toMatchObject({ allowed: true, mode: "preview" });
    expect(service.resolveEntitlement(gate.seat, { module: "gate", siteLocationId: 45 })).toMatchObject({ allowed: false });
  });
});
