import { describe, expect, it } from "vitest";
import {
  CREW_INVALID_FOR_VENDOR,
  CREW_VALIDATION_CODES,
  FIELD_EMPLOYEE_VENDOR_MISMATCH,
  FOREMAN_FIELD_EMPLOYEE_MISMATCH,
  FOREMAN_NOT_IN_CREW,
  FOREMAN_VENDOR_MISMATCH,
  isCrewValidationCode,
} from "@workspace/crew-validation-codes";

describe("crew-validation-codes", () => {
  it("exposes the canonical set of five crew/foreman validation codes", () => {
    // Pin the exact membership of the named set. Adding or removing a
    // code is a contract change that must be coordinated with the mobile
    // mirror (see the file header for paths), so this test is
    // intentionally strict — the failure is the prompt to update the
    // mirror before merging.
    expect([...CREW_VALIDATION_CODES].sort()).toEqual([
      "crew_invalid_for_vendor",
      "field_employee_vendor_mismatch",
      "foreman_field_employee_mismatch",
      "foreman_not_in_crew",
      "foreman_vendor_mismatch",
    ]);
  });

  it("uses lowercase snake_case for every code", () => {
    for (const c of CREW_VALIDATION_CODES) {
      expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("named exports match the entries in the canonical array", () => {
    const set = new Set<string>(CREW_VALIDATION_CODES);
    expect(set.has(FOREMAN_VENDOR_MISMATCH)).toBe(true);
    expect(set.has(FOREMAN_FIELD_EMPLOYEE_MISMATCH)).toBe(true);
    expect(set.has(FIELD_EMPLOYEE_VENDOR_MISMATCH)).toBe(true);
    expect(set.has(CREW_INVALID_FOR_VENDOR)).toBe(true);
    expect(set.has(FOREMAN_NOT_IN_CREW)).toBe(true);
  });

  it("isCrewValidationCode recognizes every canonical code", () => {
    for (const c of CREW_VALIDATION_CODES) {
      expect(isCrewValidationCode(c)).toBe(true);
    }
  });

  it("isCrewValidationCode rejects unrelated values", () => {
    expect(isCrewValidationCode("off_geofence")).toBe(false);
    expect(isCrewValidationCode("ticket_state_changed")).toBe(false);
    expect(isCrewValidationCode("employee.vendor_mismatch")).toBe(false);
    expect(isCrewValidationCode(undefined)).toBe(false);
    expect(isCrewValidationCode(null)).toBe(false);
    expect(isCrewValidationCode(42)).toBe(false);
    expect(isCrewValidationCode("")).toBe(false);
  });
});
