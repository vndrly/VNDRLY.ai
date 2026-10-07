import { describe, expect, it } from "vitest";
import { isLegalConsentPayloadAccepted, LEGAL_POLICY_VERSION } from "./legal-consent";

describe("published onboarding legal policy", () => {
  it("accepts explicit acceptance of the currently published August 24 policy", () => {
    expect(LEGAL_POLICY_VERSION).toBe("2026-08-24");
    expect(isLegalConsentPayloadAccepted({ legalConsent: { accepted: true, version: "2026-08-24", smsOptIn: false } })).toBe(true);
  });
  it("refuses stale or absent acceptance without upgrading saved consent", () => {
    const old = { legalConsent: { accepted: true, version: "2026-08-20" } };
    expect(isLegalConsentPayloadAccepted(old)).toBe(false);
    expect(old.legalConsent.version).toBe("2026-08-20");
    expect(isLegalConsentPayloadAccepted({ legalConsent: { accepted: false, version: "2026-08-24" } })).toBe(false);
  });
});
