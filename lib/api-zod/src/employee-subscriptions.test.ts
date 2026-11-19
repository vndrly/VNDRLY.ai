import { expect, it } from "vitest";
import { CreateEmployeeSubscriptionSchema, subscriptionMonthlyEquivalent } from "./employee-subscriptions";
it("requires a company employee, real name and integer cost, without accepting access-plan inputs", () => {
  const input = { operationId: "12345678-1234-4234-9234-123456789abc", name: "Office", employeeKey: "person:42", amountCents: 1900, billingInterval: "year" };
  expect(CreateEmployeeSubscriptionSchema.parse(input)).toMatchObject({ name: "Office", amountCents: 1900, billingInterval: "year" });
  expect(CreateEmployeeSubscriptionSchema.safeParse({ ...input, amountCents: 19.5 }).success).toBe(false);
  expect(CreateEmployeeSubscriptionSchema.safeParse({ ...input, plan: "full_worker" }).success).toBe(false);
});
it("compares recurring costs by month while excluding paused and one-time entries", () => {
  expect(subscriptionMonthlyEquivalent({ amountCents: 12000, billingInterval: "year", status: "active" })).toBe(1000);
  expect(subscriptionMonthlyEquivalent({ amountCents: 6000, billingInterval: "quarter", status: "active" })).toBe(2000);
  expect(subscriptionMonthlyEquivalent({ amountCents: 1000, billingInterval: "month", status: "paused" })).toBe(0);
  expect(subscriptionMonthlyEquivalent({ amountCents: 1900, billingInterval: "one_time", status: "active" })).toBe(0);
});
