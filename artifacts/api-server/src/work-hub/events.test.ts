import { describe, expect, it } from "vitest";
import { createWorkHubEventBus } from "./events";

describe("Work Hub event bus", () => {
  it("delivers events only to their named recipient and advances sequence", () => {
    const bus = createWorkHubEventBus();
    const user45: number[] = [];
    const user46: number[] = [];
    bus.subscribe(45, (event) => user45.push(event.sequence));
    bus.subscribe(46, (event) => user46.push(event.sequence));
    const event = bus.publish({
      type: "work_hub.message.created",
      owner: { type: "vendor", id: 12 },
      context: { kind: "ticket", id: 481 },
      subject: { type: "message", id: "60fb5c6d-4164-4b3f-baa1-1d7095426633" },
      recipientUserId: 45,
    });
    expect(event.sequence).toBe(1);
    expect(user45).toEqual([1]);
    expect(user46).toEqual([]);
    expect(bus.currentSequence()).toBe(1);
  });

  it("unsubscribes without affecting another recipient", () => {
    const bus = createWorkHubEventBus();
    let deliveries = 0;
    const unsubscribe = bus.subscribe(45, () => deliveries++);
    unsubscribe();
    bus.publish({
      type: "work_hub.task.updated", owner: { type: "vendor", id: 12 },
      context: { kind: "organization", id: 12 }, subject: { type: "task", id: 9 }, recipientUserId: 45,
    });
    expect(deliveries).toBe(0);
  });
});
