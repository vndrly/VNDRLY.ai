import { describe, expect, it } from "vitest";
import {
  onboardingTransition,
  requiredOnboardingFields,
} from "./onboarding-native";
describe("native canonical onboarding progress", () => {
  it("keeps final deferred section pending rather than manufacturing completion", () => {
    expect(onboardingTransition("vendor", "first-employee", true)).toBe(
      "first-employee",
    );
    expect(onboardingTransition("partner", "tax-billing", true)).toBe(
      "preferences",
    );
  });
  it("does not allow deferring legal or field device steps", () => {
    expect(() =>
      onboardingTransition("vendor", "legal-consent", true),
    ).toThrow();
    expect(() =>
      onboardingTransition("field_employee", "photo-certs", true),
    ).toThrow();
  });
  it("retains full required field and certification validation", () => {
    expect(requiredOnboardingFields("vendor", {})).toContain(
      "firstEmployee.email",
    );
    expect(requiredOnboardingFields("partner", {})).toContain(
      "firstSite.siteRadiusMeters",
    );
    expect(
      requiredOnboardingFields("field_employee", {
        info: {
          firstName: "Sam",
          lastName: "Demo",
          phone: "555",
          vendorRole: "invented",
        },
        photoUrl: "/objects/photo",
        pec: { certified: false, expirationDate: "2027-01-01" },
      }),
    ).toEqual(expect.arrayContaining(["info.vendorRole", "pec.certified"]));
  });
});
