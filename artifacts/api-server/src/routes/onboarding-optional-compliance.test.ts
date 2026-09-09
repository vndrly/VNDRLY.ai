import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_STEPS, STEP_REQUIRED_FIELDS } from "../assistant/onboarding-validation";

describe("temporary vendor onboarding gates", () => {
  it("does not require insurance or 1099 consent to complete onboarding", () => {
    expect(REQUIRED_STEPS.vendor).not.toContain("compliance");
    expect(STEP_REQUIRED_FIELDS.vendor.compliance).toEqual([]);
    expect(STEP_REQUIRED_FIELDS.vendor.rates).not.toContain("eDeliveryConsent");

    const route = readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");
    const validator = route.slice(
      route.indexOf("function validateVendorPayload"),
      route.indexOf('router.post("/onboarding/:orgType/:orgId/complete"'),
    );
    expect(validator).not.toContain('missing.push("compliance.');
    expect(validator).not.toContain('missing.push("eDeliveryConsent")');
  });

  it("preserves previously stored insurance and consent when optional fields are omitted", () => {
    const route = readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");
    expect(route).toContain("const compliancePatch:");
    expect(route).not.toContain("eDeliveryConsent: payload.eDeliveryConsent === true");
  });
});
