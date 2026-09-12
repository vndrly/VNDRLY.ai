import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventsAfter: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => ({ userId: 7, vendorId: 12, role: "vendor" }),
}));
vi.mock("./workHubDevices", () => ({
  resolveActiveDeviceActor: async () => ({
    userId: 7,
    owner: { type: "vendor", id: 12 },
  }),
}));
vi.mock("../work-hub/device-coordinator", () => ({
  eventsAfter: mocks.eventsAfter,
}));

import events from "./workHubEvents";

const app = express().use(events);

describe("Work Hub bounded event polling", () => {
  it("returns durable event payloads after the native cursor", async () => {
    mocks.eventsAfter.mockResolvedValue({
      gap: false,
      earliestSequence: 40,
      latestSequence: 42,
      events: [
        {
          id: "event-42",
          sequence: 42,
          userId: 7,
          owner: { type: "vendor", id: 12 },
          eventType: "work_hub.call.answered",
          payload: {
            context: { kind: "meeting", id: "room1" },
            subject: { type: "work_hub_call", id: "call1" },
          },
          createdAt: new Date("2026-09-12T12:00:00.000Z"),
        },
      ],
    });

    const response = await request(app)
      .get("/work-hub/events?transport=poll&after=41")
      .timeout({ response: 300, deadline: 600 });

    expect(response.status).toBe(200);
    expect(mocks.eventsAfter).toHaveBeenCalledWith(
      { userId: 7, owner: { type: "vendor", id: 12 } },
      41,
    );
    expect(response.body).toEqual({
      gap: false,
      latestSequence: 42,
      events: [
        {
          sequence: 42,
          type: "work_hub.call.answered",
          payload: {
            context: { kind: "meeting", id: "room1" },
            subject: { type: "work_hub_call", id: "call1" },
          },
          occurredAt: "2026-09-12T12:00:00.000Z",
        },
      ],
    });
  });
});
