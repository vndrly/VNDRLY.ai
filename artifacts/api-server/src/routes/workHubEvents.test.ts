import { describe, expect, it } from "vitest";
import { createDeviceCoordinator, type DeviceCoordinatorStore, type DurableUserEvent } from "../work-hub/device-coordinator";

describe("Work Hub durable event cursor recovery", () => {
  it("returns ordered events after the cursor and signals an expired cursor", async () => {
    const events: DurableUserEvent[] = [5, 6].map(sequence => ({ id: `event-${sequence}`, sequence, userId: 7, owner: { type: "vendor", id: 12 }, eventType: "work_hub.workspace.updated", payload: {}, createdAt: new Date() }));
    const store = {
      listExpiredEventActors: async () => [],
      pruneEvents: async () => 0,
      eventBounds: async () => ({ earliest: 5, latest: 6 }),
      listEventsAfter: async (_actor: unknown, cursor: number) => events.filter(event => event.sequence > cursor),
    } as unknown as DeviceCoordinatorStore;
    const coordinator = createDeviceCoordinator(store);
    const actor = { userId: 7, owner: { type: "vendor" as const, id: 12 } };
    expect((await coordinator.eventsAfter(actor, 5)).events.map(event => event.sequence)).toEqual([6]);
    expect(await coordinator.eventsAfter(actor, 2)).toMatchObject({ gap: true, events: [] });
  });
});
