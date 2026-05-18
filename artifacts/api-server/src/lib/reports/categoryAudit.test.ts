import { describe, expect, it } from "vitest";
import { suspectMatch } from "./categoryAudit";

describe("suspectMatch", () => {
  it("flags labor lines tagged with rents (NEC/MISC mix)", () => {
    const m = suspectMatch("labor_regular", "misc_rents");
    expect(m.suspect).toBe(true);
    expect(m.suggested).toContain("nec");
  });

  it("accepts labor lines with NEC", () => {
    expect(suspectMatch("labor_regular", "nec").suspect).toBe(false);
    expect(suspectMatch("labor_overtime", "nec").suspect).toBe(false);
  });

  it("accepts labor lines tagged for medical / attorney boxes", () => {
    expect(suspectMatch("labor_regular", "misc_medical_health").suspect).toBe(
      false,
    );
    expect(suspectMatch("labor_regular", "misc_attorney").suspect).toBe(false);
  });

  it("flags equipment lines tagged with NEC (rents only)", () => {
    const m = suspectMatch("equipment", "nec");
    expect(m.suspect).toBe(true);
    expect(m.suggested).toEqual(["misc_rents", "none"]);
  });

  it("accepts equipment lines tagged with rents", () => {
    expect(suspectMatch("equipment", "misc_rents").suspect).toBe(false);
  });

  it("flags mileage / per_diem / discount lines that have any 1099 category", () => {
    expect(suspectMatch("mileage", "nec").suspect).toBe(true);
    expect(suspectMatch("per_diem", "misc_rents").suspect).toBe(true);
    expect(suspectMatch("discount", "misc_other_income").suspect).toBe(true);
  });

  it("accepts mileage / per_diem / discount lines with no category", () => {
    expect(suspectMatch("mileage", "none").suspect).toBe(false);
    expect(suspectMatch("per_diem", "none").suspect).toBe(false);
    expect(suspectMatch("discount", "none").suspect).toBe(false);
  });

  it("does not flag unconstrained line types (markup, other)", () => {
    expect(suspectMatch("markup", "nec").suspect).toBe(false);
    expect(suspectMatch("other", "misc_rents").suspect).toBe(false);
    expect(suspectMatch("markup", "none").suspect).toBe(false);
  });

  it("returns no suggestion when inputs are missing", () => {
    expect(suspectMatch(null, "nec")).toEqual({ suspect: false, suggested: [] });
    expect(suspectMatch("labor_regular", null)).toEqual({
      suspect: false,
      suggested: [],
    });
    expect(suspectMatch("", "")).toEqual({ suspect: false, suggested: [] });
  });

  it("does not flag unknown line types (forward-compat)", () => {
    expect(suspectMatch("future_line_type", "nec").suspect).toBe(false);
  });
});
