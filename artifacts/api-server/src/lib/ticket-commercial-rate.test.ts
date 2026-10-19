import { describe, expect, it } from "vitest";
import {
  resolveTicketCommercialRate,
  requireAutomaticHourlyRate,
} from "./ticket-commercial-rate";

describe("accepted ticket commercial rates", () => {
  const frozen = {
    unitPrice: "125.00",
    unit: "hour",
    currency: "USD",
    billingRules: {
      dailyOtHours: "8",
      weeklyOtHours: "40",
      overtimeMultiplier: "1.5",
    },
  };
  it("uses the acceptance snapshot after vendor and employee prices change", () => {
    const currentVendorRate = { unitPrice: "900.00" };
    expect(
      resolveTicketCommercialRate({ jobOfferId: 7 }, frozen)?.unitPrice,
    ).toBe("125.00");
    currentVendorRate.unitPrice = "999.00";
    expect(
      requireAutomaticHourlyRate(
        resolveTicketCommercialRate({ jobOfferId: 7 }, frozen),
      )?.unitPrice,
    ).toBe("125.00");
  });
  it("permits legacy fallback only for non-marketplace tickets", () => {
    expect(resolveTicketCommercialRate({ jobOfferId: null }, null)).toBeNull();
    expect(() => resolveTicketCommercialRate({ jobOfferId: 7 }, null)).toThrow(
      "marketplace.acceptance_snapshot_required",
    );
    expect(() =>
      resolveTicketCommercialRate(
        { jobOfferId: 7 },
        { ...frozen, unitPrice: "NaN" },
      ),
    ).toThrow();
  });
  it("preserves complex component prices without guessing their automatic calculation", () => {
    const terms = resolveTicketCommercialRate(
      { jobOfferId: 7 },
      { ...frozen, rateComponents: { mobilization: "500" } },
    );
    expect(terms).toMatchObject({
      rateComponents: { mobilization: "500" },
      automaticBilling: "manual_billing_required",
    });
  });
  it.each([
    ["day", "USD"],
    ["hour", "CAD"],
    ["job", "EUR"],
  ])(
    "preserves %s/%s terms but blocks automatic hourly USD billing",
    (unit, currency) => {
      const terms = resolveTicketCommercialRate(
        { jobOfferId: 7 },
        { ...frozen, unit, currency },
      );
      expect(terms).toMatchObject({
        unit,
        currency,
        unitPrice: "125.00",
        automaticBilling: "manual_billing_required",
      });
      expect(() => requireAutomaticHourlyRate(terms)).toThrow(
        "manual_billing_required",
      );
    },
  );
});
