import { describe, expect, it } from "vitest";

import {
  GATEKEEPER_TAB_KEYS,
  homeTabTitleKey,
  isFieldEmployeeUser,
  isForemanEmployeeUser,
  isGatekeeperTabKey,
  isGatekeeperUser,
  isOfficeMobileViewer,
  isPartnerOfficeUser,
  isVendorOfficeUser,
} from "@/lib/mobile-viewer";

describe("mobile-viewer role helpers", () => {
  it("recognizes direct and sponsored gate workers without granting office identity", () => {
    for (const vendorRole of ["gatekeeper", "gate_supervisor"] as const) {
      const directWorker = { role: "field_employee", vendorRole };
      const worker = {
        ...directWorker,
        managedSubcontractor: { siteGrants: [{ siteId: 7, role: vendorRole }] },
      };
      expect(isGatekeeperUser(directWorker)).toBe(true);
      expect(isOfficeMobileViewer(directWorker)).toBe(false);
      expect(isGatekeeperUser(worker)).toBe(true);
      expect(isOfficeMobileViewer(worker)).toBe(false);
    }
  });
  it("detects field employee and foreman", () => {
    expect(isFieldEmployeeUser({ role: "field_employee" })).toBe(true);
    expect(
      isForemanEmployeeUser({ role: "field_employee", vendorRole: "foreman" }),
    ).toBe(true);
    expect(
      isForemanEmployeeUser({ role: "field_employee", vendorRole: "field" }),
    ).toBe(false);
  });

  it("detects office viewers", () => {
    expect(isVendorOfficeUser({ role: "vendor" })).toBe(true);
    expect(isPartnerOfficeUser({ role: "partner" })).toBe(true);
    expect(isOfficeMobileViewer({ role: "partner" })).toBe(true);
    expect(isOfficeMobileViewer({ role: "field_employee" })).toBe(false);
  });

  it("uses the explicit gatekeeper vendor role and keeps it out of office viewer mode", () => {
    const gateUser = {
      role: "vendor",
      username: "gate@winchester.com",
      displayName: null,
      vendorRole: "gatekeeper",
    };
    expect(isGatekeeperUser(gateUser)).toBe(true);
    expect(isOfficeMobileViewer(gateUser)).toBe(false);
    expect(homeTabTitleKey(gateUser)).toBe("gatekeeper.portal");
    expect(
      isGatekeeperUser({
        role: "vendor",
        username: "office@winchester.com",
        vendorRole: "gatekeeper",
      }),
    ).toBe(true);
    expect(
      isGatekeeperUser({
        role: "vendor",
        username: "gate@winchester.com",
        vendorRole: null,
      }),
    ).toBe(false);
    expect(
      isGatekeeperUser({
        role: "vendor",
        username: "winchester",
        vendorRole: null,
      }),
    ).toBe(false);
    expect(GATEKEEPER_TAB_KEYS).toEqual([
      "askv",
      "gate",
      "gate-history",
      "change-over",
      "shift-notes",
      "gate-notifications",
      "gate-notification-preferences",
      "profile",
    ]);
    expect(isGatekeeperTabKey("gate-history")).toBe(true);
    expect(isGatekeeperTabKey("gate-notifications")).toBe(true);
    expect(isGatekeeperTabKey("gate-notification-preferences")).toBe(true);
    expect(isGatekeeperTabKey("index")).toBe(false);
    expect(isGatekeeperUser({ role: "vendor", vendorRole: "gate_supervisor" })).toBe(true);
  });

  it("picks role-appropriate home tab titles", () => {
    expect(
      homeTabTitleKey({ role: "field_employee", vendorRole: "foreman" }),
    ).toBe("foremanHome.portal");
    expect(homeTabTitleKey({ role: "vendor" })).toBe("vendorHome.portal");
    expect(homeTabTitleKey({ role: "partner" })).toBe("partnerHome.portal");
    expect(
      homeTabTitleKey({ role: "field_employee", vendorRole: "field" }),
    ).toBe("tabs.home");
  });
});
