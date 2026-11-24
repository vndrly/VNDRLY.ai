import { expect, it } from "vitest";
import { gateGoDemoCosts } from "./gate-demo-costs";

it("keeps the authorized demo ticket's wages, expenses, and reserve in cents", () => {
  const costs = gateGoDemoCosts({
    id: 1870000255,
    siteName: "Synthetic Site",
    gateName: "Synthetic Gate",
    invoiceCents: 500000,
    payrollCents: null,
  });
  expect(costs).toMatchObject({
    wages: 180000,
    employerTaxes: 18000,
    equipment: 90500,
    profit: 211500,
    reserve: 44415,
  });
});

it("does not invent demo expenses for another ticket", () => {
  expect(gateGoDemoCosts({ id: 17, siteName: "Synthetic Site", gateName: null, invoiceCents: 10000, payrollCents: null })).toBeNull();
});
