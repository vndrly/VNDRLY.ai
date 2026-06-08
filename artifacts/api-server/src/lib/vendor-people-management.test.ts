import { describe, expect, it } from "vitest";
import {
  isPecCurrent,
  membershipRoleForVendorPerson,
  sessionUserRoleForVendorPerson,
  usesFieldEmployeeLogin,
} from "./vendor-people-management";

describe("vendor-people-management", () => {
  it("detects current PEC from expiration date", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const iso = future.toISOString().slice(0, 10);
    expect(isPecCurrent({ pecExpirationDate: iso, pecCertification: false })).toBe(true);
  });

  it("maps field roles to field_employee login", () => {
    expect(usesFieldEmployeeLogin("field")).toBe(true);
    expect(sessionUserRoleForVendorPerson("field")).toBe("field_employee");
    expect(membershipRoleForVendorPerson("field")).toBe("field_employee");
  });

  it("maps office/admin roles to vendor portal login", () => {
    expect(usesFieldEmployeeLogin("office")).toBe(false);
    expect(sessionUserRoleForVendorPerson("admin")).toBe("vendor");
    expect(membershipRoleForVendorPerson("admin")).toBe("admin");
    expect(membershipRoleForVendorPerson("office")).toBe("member");
  });
});
