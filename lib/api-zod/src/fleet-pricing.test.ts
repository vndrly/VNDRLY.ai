import { expect, it } from "vitest";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";

function schema(name: string): ZodType {
  const value = (contracts as unknown as Record<string, ZodType>)[name];
  expect(value, name).toBeDefined();
  return value;
}
it("preserves exact prices as strings and rejects excess precision or floating wire prices", () => {
  const decimal = schema("FleetExactDecimalSchema");
  expect(decimal.safeParse("0.000125").success).toBe(true);
  expect(decimal.safeParse(0.000125).success).toBe(false);
  expect(decimal.safeParse("0.0000000001").success).toBe(false);
  expect(decimal.safeParse("1000000000000000").success).toBe(false);
});
it("records unpriced work explicitly instead of silently pricing it at zero", () => {
  const pricing = schema("FleetPricingIntentSchema");
  expect(pricing.safeParse({ mode: "unpriced", reason: "offline_reference_missing", serviceId: 7, approvalRef: null }).success).toBe(true);
  expect(pricing.safeParse({ mode: "unpriced", reason: "offline_reference_missing", serviceId: 7, approvalRef: null, rate: "0" }).success).toBe(false);
});
it("supports explicit delivered, accepted and billable quantities without implicit conversion", () => {
  expect(schema("FleetQuantityEvidenceSchema").safeParse({ id: "11111111-1111-4111-8111-111111111111", cycleId: null, kind: "delivered", quantity: "123.456789", unit: "barrel", source: "meter", evidenceReferences: [], capturedAt: "2026-10-16T12:00:00Z", recordedByUserId: 42 }).success).toBe(true);
});
