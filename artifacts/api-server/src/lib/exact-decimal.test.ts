import { describe, expect, it } from "vitest";
import * as decimal from "@workspace/db/format";

function arithmetic() {
  expect(decimal).toHaveProperty("parseExactDecimal");
  return decimal as typeof import("../../../../lib/db/src/format/exact-decimal");
}
describe("exact commercial decimal arithmetic", () => {
  it("retains sub-cent product precision before currency rounding", () => {
    const d = arithmetic();
    const result = d.multiplyExact(d.parseExactDecimal("123.456789"), d.parseExactDecimal("0.000125"));
    expect(d.formatExact(result)).toBe("0.015432098625");
    expect(d.formatExact(d.roundExact(result, { scale: 2, rounding: "half_away_from_zero" }))).toBe("0.02");
  });
  it("adds and subtracts decimals without binary floating-point drift", () => {
    const d = arithmetic();
    expect(d.formatExact(d.addExact(d.parseExactDecimal("0.1"), d.parseExactDecimal("0.2")))).toBe("0.3");
    expect(d.formatExact(d.subtractExact(d.parseExactDecimal("100"), d.parseExactDecimal("80")))).toBe("20");
  });
  it.each(["1.0000000001", "1000000000000000", "1e3", "1.2x", "NaN", "Infinity", "+1", " 1", "01"])("refuses unsupported input %s without truncation", value => {
    const d = arithmetic();
    expect(() => d.parseExactDecimal(value)).toThrow();
  });
  it("rounds positive and negative ties symmetrically", () => {
    const d = arithmetic();
    expect(d.formatExact(d.roundExact(d.parseExactDecimal("1.005"), { scale: 2, rounding: "half_away_from_zero" }))).toBe("1.01");
    expect(d.formatExact(d.roundExact(d.parseExactDecimal("-1.005"), { scale: 2, rounding: "half_away_from_zero" }))).toBe("-1.01");
    expect(d.formatExact(d.roundExact(d.parseExactDecimal("-1.009"), { scale: 2, rounding: "toward_zero" }))).toBe("-1");
  });
  it("requires explicit scale/rounding for division and refuses zero divisors", () => {
    const d = arithmetic();
    expect(d.formatExact(d.divideExact(d.parseExactDecimal("1"), d.parseExactDecimal("3"), { scale: 9, rounding: "half_away_from_zero" }))).toBe("0.333333333");
    expect(d.formatExact(d.divideExact(d.parseExactDecimal("-1"), d.parseExactDecimal("8"), { scale: 2, rounding: "away_from_zero" }))).toBe("-0.13");
    expect(() => d.divideExact(d.parseExactDecimal("1"), d.parseExactDecimal("0"), { scale: 2, rounding: "half_away_from_zero" })).toThrow("zero");
  });
  it("round-trips the numeric(24,9) boundary and normalizes negative zero", () => {
    const d = arithmetic();
    expect(d.formatExact(d.parseExactDecimal("999999999999999.999999999"))).toBe("999999999999999.999999999");
    expect(d.formatExact(d.parseExactDecimal("-0.000000000"))).toBe("0");
  });
});
