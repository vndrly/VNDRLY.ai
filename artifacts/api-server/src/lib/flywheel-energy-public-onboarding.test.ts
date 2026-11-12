import { describe, expect, it } from "vitest";
import {
  FLYWHEEL_DISPLAY_NAME,
  FLYWHEEL_LEGAL_NAME,
  FLYWHEEL_PUBLIC_CONTACTS,
  FLYWHEEL_PUBLIC_PROFILE,
  FLYWHEEL_SPUR_SITE_CODE,
  buildOnboardingPayload,
  buildPartnerPatch,
  isPlaceholderContactName,
} from "./flywheel-energy-public-onboarding.js";

describe("Flywheel Energy public onboarding profile", () => {
  it("uses the published legal entity, HQ, and switchboard from flywheelenergy.com", () => {
    expect(FLYWHEEL_DISPLAY_NAME).toBe("Flywheel Energy");
    expect(FLYWHEEL_LEGAL_NAME).toBe("Flywheel Energy, LLC");
    expect(FLYWHEEL_PUBLIC_PROFILE.physicalAddress).toMatch(/621 N\. Robinson/i);
    expect(FLYWHEEL_PUBLIC_PROFILE.physicalAddress).toMatch(/Suite 300/i);
    expect(FLYWHEEL_PUBLIC_PROFILE.physicalAddress).toMatch(/Oklahoma City, OK 73102/);
    expect(FLYWHEEL_PUBLIC_PROFILE.billingAddress).toBe(
      FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
    );
    expect(FLYWHEEL_PUBLIC_PROFILE.contactPhone).toBe("(405) 702-6991");
    expect(FLYWHEEL_PUBLIC_PROFILE.businessPhone).toBe("(405) 702-6991");
    expect(FLYWHEEL_PUBLIC_PROFILE.contactEmail).toBe("info@flywheelenergy.com");
    expect(FLYWHEEL_PUBLIC_PROFILE.contactName).toBe("Justin Cope");
    expect(FLYWHEEL_PUBLIC_PROFILE.blurb).toMatch(/private exploration and production/i);
    expect(FLYWHEEL_PUBLIC_PROFILE.brandPrimaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(FLYWHEEL_PUBLIC_PROFILE.brandAccentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("lists only published departmental emails — no invented personal inboxes", () => {
    const emails = FLYWHEEL_PUBLIC_CONTACTS.map((c) => c.email.toLowerCase()).sort();
    expect(emails).toEqual(
      [
        "accountspayable@flywheelenergy.com",
        "info@flywheelenergy.com",
        "ownerrelations@flywheelenergy.com",
      ].sort(),
    );
    expect(FLYWHEEL_PUBLIC_CONTACTS.some((c) => /justin|cope|rumbelow/i.test(c.email))).toBe(
      false,
    );
  });

  it("keeps the live Spur site code used by the gate booth", () => {
    expect(FLYWHEEL_SPUR_SITE_CODE).toBe("SITE-B40D77D2");
  });
});

describe("buildPartnerPatch", () => {
  const existing = {
    name: "Flywheel Energy",
    contactName: "Flywheel Energy",
    contactEmail: "admin@flywheelenergy.com",
    contactPhone: null,
    businessPhone: null,
    physicalAddress: null,
    billingAddress: null,
    hoursOfOperation: null,
    blurb: null,
    operatingRadiusMiles: null,
    federalTaxId: null,
    stateTaxId: null,
    brandPrimaryColor: "#3a84c5",
    brandAccentColor: "#616570",
    logoUrl: "https://cdn.example/logo.png",
    logoSquareUrl: "https://cdn.example/logo-sq.png",
  };

  it("treats a contact name that is just the company name as blank", () => {
    expect(isPlaceholderContactName("Flywheel Energy", "Flywheel Energy")).toBe(true);
    expect(isPlaceholderContactName("Justin Cope", "Flywheel Energy")).toBe(false);
  });

  it("fills published HQ, phones, blurb, and CEO without touching tax IDs or existing branding", () => {
    const patch = buildPartnerPatch(existing);
    expect(patch.contactName).toBe("Justin Cope");
    expect(patch.contactPhone).toBe("(405) 702-6991");
    expect(patch.businessPhone).toBe("(405) 702-6991");
    expect(patch.physicalAddress).toMatch(/621 N\. Robinson/i);
    expect(patch.billingAddress).toBe(patch.physicalAddress);
    expect(patch.blurb).toMatch(/private exploration and production/i);
    expect(patch).not.toHaveProperty("contactEmail");
    expect(patch).not.toHaveProperty("federalTaxId");
    expect(patch).not.toHaveProperty("stateTaxId");
    expect(patch).not.toHaveProperty("brandPrimaryColor");
    expect(patch).not.toHaveProperty("brandAccentColor");
    expect(patch).not.toHaveProperty("logoUrl");
    expect(patch).not.toHaveProperty("hoursOfOperation");
    expect(patch).not.toHaveProperty("operatingRadiusMiles");
  });

  it("is a no-op when public fields are already present", () => {
    const filled = {
      ...existing,
      contactName: "Justin Cope",
      contactPhone: "(405) 702-6991",
      businessPhone: "(405) 702-6991",
      physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
      billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
      blurb: FLYWHEEL_PUBLIC_PROFILE.blurb,
    };
    expect(buildPartnerPatch(filled)).toEqual({});
  });
});

describe("buildOnboardingPayload", () => {
  it("prefills first site, HQ tax addresses, branding, and invite emails without accepting legal terms", () => {
    const payload = buildOnboardingPayload({
      existingPayload: {},
      partner: {
        brandPrimaryColor: "#3a84c5",
        brandAccentColor: "#616570",
        logoUrl: "https://cdn.example/logo.png",
        logoSquareUrl: "https://cdn.example/logo-sq.png",
        physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
        billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
      },
      firstSite: {
        name: "Flywheel Energy Spur",
        address: "34.63951, -97.66194",
        siteCode: FLYWHEEL_SPUR_SITE_CODE,
        siteRadiusMeters: 1609,
      },
    });

    expect(payload.firstSite).toEqual({
      name: "Flywheel Energy Spur",
      address: "34.63951, -97.66194",
      siteCode: FLYWHEEL_SPUR_SITE_CODE,
      siteRadiusMeters: 1609,
    });
    expect(payload.taxBilling).toEqual({
      physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
      billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
    });
    expect(payload.taxBilling).not.toHaveProperty("federalTaxId");
    expect(payload.taxBilling).not.toHaveProperty("stateTaxId");
    expect(payload.brandPrimaryColor).toBe("#3a84c5");
    expect(payload.brandAccentColor).toBe("#616570");
    expect(payload.inviteEmails).toEqual([
      "info@flywheelenergy.com",
      "ownerrelations@flywheelenergy.com",
      "accountspayable@flywheelenergy.com",
    ]);
    expect(payload.platformEula).toBeUndefined();
    expect(payload.legalConsent).toBeUndefined();
  });

  it("does not overwrite wizard values the user already typed", () => {
    const payload = buildOnboardingPayload({
      existingPayload: {
        firstSite: { name: "Custom Pad", address: "Keep me", siteCode: "SITE-CUSTOM", siteRadiusMeters: 100 },
        taxBilling: { federalTaxId: "already-set", physicalAddress: "User HQ" },
        inviteEmails: ["ops@flywheelenergy.com"],
      },
      partner: {
        brandPrimaryColor: "#3a84c5",
        brandAccentColor: "#616570",
        logoUrl: null,
        logoSquareUrl: null,
        physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
        billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
      },
      firstSite: {
        name: "Flywheel Energy Spur",
        address: "34.63951, -97.66194",
        siteCode: FLYWHEEL_SPUR_SITE_CODE,
        siteRadiusMeters: 1609,
      },
    });

    expect(payload.firstSite).toEqual({
      name: "Custom Pad",
      address: "Keep me",
      siteCode: "SITE-CUSTOM",
      siteRadiusMeters: 100,
    });
    expect(payload.taxBilling).toEqual({
      federalTaxId: "already-set",
      physicalAddress: "User HQ",
      billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
    });
    expect(payload.inviteEmails).toEqual(["ops@flywheelenergy.com"]);
  });

  it("preserves an already-accepted EULA instead of clearing it", () => {
    const payload = buildOnboardingPayload({
      existingPayload: {
        platformEula: { accepted: true, version: "1.0" },
      },
      partner: {
        brandPrimaryColor: "#3a84c5",
        brandAccentColor: "#616570",
        logoUrl: null,
        logoSquareUrl: null,
        physicalAddress: FLYWHEEL_PUBLIC_PROFILE.physicalAddress,
        billingAddress: FLYWHEEL_PUBLIC_PROFILE.billingAddress,
      },
    });
    expect(payload.platformEula).toEqual({ accepted: true, version: "1.0" });
  });
});
