import { describe, expect, it } from "vitest";
import { recognitionMatchesVisit, vehicleAppearanceSummary } from "./recognition";
describe("recognition identity boundary", () => {
  it("matches punctuation but never fuzzy plates or conflicting states", () => {
    const candidate = { plate: "ABC-123", state: "OK" };
    expect(recognitionMatchesVisit(candidate, { vehiclePlate: "abc123", plateState: "OK" })).toBe(true);
    expect(recognitionMatchesVisit(candidate, { vehiclePlate: "abc128", plateState: "OK" })).toBe(false);
    expect(recognitionMatchesVisit(candidate, { vehiclePlate: "abc123", plateState: "TX" })).toBe(false);
    expect(recognitionMatchesVisit({ plate: null, state: null }, {})).toBe(false);
  });
  it("permits review of a state-unknown exact plate without inventing state", () => {
    expect(recognitionMatchesVisit({ plate: "ABC123", state: null }, { vehiclePlate: "ABC123", plateState: "OK" })).toBe(true);
    expect(vehicleAppearanceSummary({ color: "white", make: null, model: null, bodyType: "pickup", markings: ["unit 12"] })).toBe("white · pickup · unit 12");
  });
});
