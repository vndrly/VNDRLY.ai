import { expect, it } from "vitest";
import {
  GateDailyBillingConfigureSchema,
  GateDailyBillingCloseSchema,
} from "./gate-daily-billing";
const id = "10000000-0000-4000-8000-000000000001";
it("defaults to full daily rate and continuation without silently enabling a schedule", () => {
  expect(
    GateDailyBillingConfigureSchema.parse({
      operationId: id,
      expectedVersion: 0,
      workTypeId: 1,
      startDay: "2026-10-01",
      agreementReference: "Agreement1",
      confirmedUnbilledStart: true,
    }),
  ).toMatchObject({ partialDayRule: "full_day", autoInvoiceEveryDays: null });
  expect(
    GateDailyBillingCloseSchema.parse({
      operationId: id,
      expectedVersion: 1,
      previewFingerprint: "a".repeat(64),
    }),
  ).toMatchObject({
    continueBilling: true,
    acknowledgeCoverageGaps: false,
    minimumCompletedDays: null,
  });
});
it("never accepts client rates, billing cutoffs, membership or unconfirmed prior unbilled dates", () => {
  const save = {
    operationId: id,
    expectedVersion: 0,
    workTypeId: 1,
    startDay: "2026-10-01",
    agreementReference: "Agreement1",
    confirmedUnbilledStart: true,
  };
  for (const input of [
    { ...save, dailyRateCents: 1 },
    { ...save, vendorId: 999 },
    { ...save, confirmedUnbilledStart: false },
    { ...save, autoInvoiceEveryDays: 0 },
  ])
    expect(() => GateDailyBillingConfigureSchema.parse(input)).toThrow();
  expect(() =>
    GateDailyBillingCloseSchema.parse({
      operationId: id,
      expectedVersion: 1,
      previewFingerprint: "a".repeat(64),
      cutoff: "2026-10-03",
    }),
  ).toThrow();
});
