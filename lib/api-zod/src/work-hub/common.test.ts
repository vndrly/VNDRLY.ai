import { describe, expect, it } from "vitest";
import {
  workHubCommandEnvelopeSchema,
  workHubContextRefSchema,
  workHubEventEnvelopeSchema,
  workHubOwnerSchema,
} from "./index";

describe("Work Hub shared contracts", () => {
  it("requires an explicit positive tenant owner", () => {
    expect(workHubOwnerSchema.safeParse({ type: "vendor", id: 12 }).success).toBe(true);
    expect(workHubOwnerSchema.safeParse({ type: "partner", id: 0 }).success).toBe(false);
    expect(workHubOwnerSchema.safeParse({ type: "platform", id: 1 }).success).toBe(false);
  });

  it("accepts only supported contextual channel references", () => {
    expect(workHubContextRefSchema.safeParse({ kind: "ticket", id: 481 }).success).toBe(true);
    expect(workHubContextRefSchema.safeParse({ kind: "gate", id: "company:12:site:41" }).success).toBe(true);
    expect(workHubContextRefSchema.safeParse({ kind: "global", id: 1 }).success).toBe(false);
  });

  it("requires a durable UUID and versioned payload for commands", () => {
    const valid = {
      operationId: "60fb5c6d-4164-4b3f-baa1-1d7095426633",
      owner: { type: "vendor", id: 12 },
      context: { kind: "ticket", id: 481 },
      expectedVersion: 1,
      payloadVersion: 1,
      payload: { body: "On my way" },
    };

    expect(workHubCommandEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(workHubCommandEnvelopeSchema.safeParse({ ...valid, operationId: "1" }).success).toBe(false);
    expect(workHubCommandEnvelopeSchema.safeParse({ ...valid, payloadVersion: 2 }).success).toBe(false);
  });

  it("requires recipient-scoped versioned events", () => {
    const result = workHubEventEnvelopeSchema.safeParse({
      version: 1,
      sequence: 4812,
      type: "work_hub.message.created",
      owner: { type: "vendor", id: 12 },
      context: { kind: "ticket", id: 481 },
      subject: { type: "message", id: "60fb5c6d-4164-4b3f-baa1-1d7095426633" },
      recipientUserId: 45,
      occurredAt: "2026-09-08T18:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
