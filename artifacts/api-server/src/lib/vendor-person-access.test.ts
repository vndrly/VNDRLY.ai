import { describe, expect, it } from "vitest";
import {
  legacyOperationalRoles,
  mayPerformGateAction,
  projectLegacyVendorRole,
  type VendorPersonAccess,
} from "./vendor-person-access.js";

function access(overrides: Partial<VendorPersonAccess> = {}): VendorPersonAccess {
  return {
    vendorId: 1054,
    vendorPeopleId: 99,
    isVendorAdmin: false,
    operationalRoles: [],
    siteScope: { kind: "selected", siteIds: [] },
    siteIds: [],
    legacyVendorRole: null,
    ...overrides,
  };
}

describe("vendor person access model", () => {
  it("backfills both into office and field employee roles", () => {
    expect(legacyOperationalRoles("both")).toEqual(["office", "field_employee"]);
  });

  it("maps every recognized legacy role without inventing permissions", () => {
    expect(legacyOperationalRoles("office")).toEqual(["office"]);
    expect(legacyOperationalRoles("field")).toEqual(["field_employee"]);
    expect(legacyOperationalRoles("foreman")).toEqual(["foreman"]);
    expect(legacyOperationalRoles("gatekeeper")).toEqual(["gatekeeper"]);
    expect(legacyOperationalRoles("gate_supervisor")).toEqual(["gate_supervisor"]);
    expect(legacyOperationalRoles("admin")).toEqual([]);
    expect(legacyOperationalRoles("unknown")).toEqual([]);
  });

  it("projects multiple roles for unchanged clients deterministically", () => {
    expect(projectLegacyVendorRole(["office", "field_employee"])).toBe("both");
    expect(projectLegacyVendorRole(["office", "gatekeeper", "gate_supervisor"])).toBe("gate_supervisor");
    expect(projectLegacyVendorRole(["office"])).toBe("office");
  });

  it("gives a vendor admin gate authority at every resolved authorized site", () => {
    const admin = access({
      isVendorAdmin: true,
      siteScope: { kind: "all_authorized" },
      siteIds: [22, 44],
    });
    expect(mayPerformGateAction(admin, 22, "gatekeeper")).toBe(true);
    expect(mayPerformGateAction(admin, 44, "gate_supervisor")).toBe(true);
    expect(mayPerformGateAction(admin, 55, "gate_supervisor")).toBe(false);
  });

  it("requires both a matching role and explicit site access for non-admins", () => {
    const worker = access({ operationalRoles: ["gatekeeper"], siteIds: [22], siteScope: { kind: "selected", siteIds: [22] } });
    expect(mayPerformGateAction(worker, 22, "gatekeeper")).toBe(true);
    expect(mayPerformGateAction(worker, 44, "gatekeeper")).toBe(false);
    expect(mayPerformGateAction(worker, 22, "gate_supervisor")).toBe(false);
  });
});
