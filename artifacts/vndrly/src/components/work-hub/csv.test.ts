import { describe, it, expect } from "vitest";
import { parseCsv, toCsv } from "./csv";
describe("Work Hub CSV handling", () => {
  it("reads escaped quotes, commas and embedded newlines", () => {
    expect(parseCsv('Name,Note\r\n"A, B","Line 1\n""Quoted"""')).toEqual([["Name", "Note"], ["A, B", 'Line 1\n"Quoted"']]);
  });
  it("rejects malformed rows instead of silently mapping the wrong columns", () => {
    expect(() => parseCsv("A,B\n1,2,3")).toThrow("same number");
    expect(() => parseCsv('A\n"Unclosed')).toThrow("not closed");
  });
  it("neutralizes spreadsheet formulas in exported text", () => {
    expect(toCsv(["Title"], [["=HYPERLINK(\"https://example.invalid\")"], ["  +123"], ["ordinary"]])).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(toCsv(["Title"], [["  +123"]])).toContain('"\'  +123"');
  });
});
