import { expect, it } from "vitest";
import {
  isManagedSubcontractor,
  normalizeManagedSubcontractor,
} from "./managed-subcontractor-access";

it("keeps managed workers in their restricted portal even when all site grants are revoked", () => {
  expect(
    isManagedSubcontractor({
      role: "field_employee",
      managedSubcontractor: { siteGrants: [] },
    }),
  ).toBe(true);
  expect(isManagedSubcontractor({ role: "field_employee" })).toBe(false);
  expect(
    isManagedSubcontractor({
      role: "admin",
      managedSubcontractor: { siteGrants: [] },
    }),
  ).toBe(false);
});
it("only accepts valid operational site grants from the auth response", () => {
  expect(
    normalizeManagedSubcontractor({
      siteGrants: [
        { siteId: 3, role: "gatekeeper" },
        { siteId: 4, role: "admin" },
        null,
      ],
    }),
  ).toEqual({ siteGrants: [{ siteId: 3, role: "gatekeeper" }] });
  expect(normalizeManagedSubcontractor(null)).toBeUndefined();
});
