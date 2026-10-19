import { describe, it, expect } from "vitest";
async function classify(input: unknown) {
  const module = await import("./fleet-compliance-rulebook").catch(() => null);
  expect(module, "Sourced rulebook").not.toBeNull();
  return module!.classifyFleetInsuranceReference(input);
}
const base = {
  jurisdiction: "federal",
  carrierType: "for_hire",
  commodity: "nonhaz_property",
  gvwrLb: 10001,
  regulatedOperation: true,
  classificationReviewed: true,
};
describe("Federal Oklahoma Texas insurance research fixtures checked 2026-10-16", () => {
  it.each([
    [10000, "300000"],
    [10001, "750000"],
  ])(
    "uses the federal nonhazardous for-hire boundary %s",
    async (weight, minimum) => {
      const result = await classify({ ...base, gvwrLb: weight });
      expect(result.minimumUSD).toBe(minimum);
      expect(result.source.checkedAt).toBe("2026-10-16");
      expect(result.status).toBe("reference_only");
    },
  );
  it.each([
    [9999, "300000"],
    [10000, "750000"],
  ])(
    "uses the distinct Oklahoma 10000 boundary %s",
    async (weight, minimum) => {
      const result = await classify({
        ...base,
        jurisdiction: "OK",
        gvwrLb: weight,
        carrierAllVehiclesUnder10000: weight < 10000,
      });
      expect(result.minimumUSD).toBe(minimum);
      expect(result.source.section).toContain("165:30-3-11");
    },
  );
  it("does not infer that an Oklahoma carrier uses only light vehicles from this one truck", async () => {
    expect(
      (await classify({ ...base, jurisdiction: "OK", gvwrLb: 9999 }))
        .minimumUSD,
    ).toBeNull();
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "OK",
          gvwrLb: 9999,
          carrierAllVehiclesUnder10000: false,
        })
      ).minimumUSD,
    ).toBe("750000");
  });
  it("separates Oklahoma private, restricted-property and deleterious classes", async () => {
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "OK",
          carrierType: "private",
          gvwrLb: 30000,
        })
      ).minimumUSD,
    ).toBe("350000");
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "OK",
          commodity: "ok_restricted_property",
        })
      ).minimumUSD,
    ).toBe("350000");
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "OK",
          commodity: "ok_deleterious",
        })
      ).minimumUSD,
    ).toBe("750000");
  });
  it("does not treat Texas petroleum as the general 500000 property class", async () => {
    expect(
      (await classify({ ...base, jurisdiction: "TX", gvwrLb: 30000 }))
        .minimumUSD,
    ).toBe("500000");
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "TX",
          commodity: "tx_oil_fuel_rule",
          gvwrLb: 30000,
        })
      ).minimumUSD,
    ).toBe("1000000");
    expect(
      (
        await classify({
          ...base,
          jurisdiction: "TX",
          commodity: "tx_high_hazard_rule",
          gvwrLb: 30000,
        })
      ).minimumUSD,
    ).toBe("5000000");
  });
  it("keeps unclassified crude, unknown weight, private federal scope and unreviewed facts unresolved", async () => {
    for (const input of [
      { ...base, commodity: "unclassified" },
      { ...base, gvwrLb: null },
      { ...base, classificationReviewed: false },
      { ...base, carrierType: "private" },
      { ...base, jurisdiction: "TX", gvwrLb: 26000 },
    ]) {
      const result = await classify(input);
      expect(result.status).toBe("needs_review");
      expect(result.minimumUSD).toBeNull();
    }
  });
  it("never calls an excluded operation compliant or silently gives it a zero limit", async () => {
    const result = await classify({ ...base, regulatedOperation: false });
    expect(result.status).toBe("not_applicable");
    expect(result.minimumUSD).toBeNull();
    expect(result).not.toHaveProperty("compliant");
  });
});
