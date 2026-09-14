import { describe, expect, it } from "vitest";
import { OperationEnvelopeSchema } from "./common";

describe("Implementation A operation envelope", () => {
  it("accepts a durable operation with device and occurrence context", () => {
    const operationId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();

    expect(
      OperationEnvelopeSchema.parse({
        operationId,
        occurredAt,
        deviceId: "device-1",
        payload: { value: 1 },
      }),
    ).toMatchObject({ operationId, occurredAt, deviceId: "device-1", payload: { value: 1 } });
  });

  it("rejects invalid operation identifiers", () => {
    expect(() =>
      OperationEnvelopeSchema.parse({
        operationId: "not-a-uuid",
        occurredAt: new Date().toISOString(),
        deviceId: "device-1",
        payload: {},
      }),
    ).toThrow();
  });
});
