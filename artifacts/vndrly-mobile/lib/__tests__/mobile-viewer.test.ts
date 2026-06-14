import { describe, expect, it } from "vitest";

import {
  homeTabTitleKey,
  isFieldEmployeeUser,
  isForemanEmployeeUser,
  isOfficeMobileViewer,
  isPartnerOfficeUser,
  isVendorOfficeUser,
} from "@/lib/mobile-viewer";

describe("mobile-viewer role helpers", () => {
  it("detects field employee and foreman", () => {
    expect(isFieldEmployeeUser({ role: "field_employee" })).toBe(true);
    expect(
      isForemanEmployeeUser({ role: "field_employee", vendorRole: "foreman" }),
    ).toBe(true);
    expect(isForemanEmployeeUser({ role: "field_employee", vendorRole: "field" })).toBe(
      false,
    );
  });

  it("detects office viewers", () => {
    expect(isVendorOfficeUser({ role: "vendor" })).toBe(true);
    expect(isPartnerOfficeUser({ role: "partner" })).toBe(true);
    expect(isOfficeMobileViewer({ role: "partner" })).toBe(true);
    expect(isOfficeMobileViewer({ role: "field_employee" })).toBe(false);
  });

  it("picks role-appropriate home tab titles", () => {
    expect(
      homeTabTitleKey({ role: "field_employee", vendorRole: "foreman" }),
    ).toBe("foremanHome.portal");
    expect(homeTabTitleKey({ role: "vendor" })).toBe("vendorHome.portal");
    expect(homeTabTitleKey({ role: "partner" })).toBe("partnerHome.portal");
    expect(homeTabTitleKey({ role: "field_employee", vendorRole: "field" })).toBe(
      "tabs.home",
    );
  });
});
