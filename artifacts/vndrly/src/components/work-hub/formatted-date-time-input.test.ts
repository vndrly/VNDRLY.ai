import { describe, expect, it } from "vitest";
import { parseTaskDateTime } from "./formatted-date-time-input";

describe("calendar date and time", () => {
  it.each([["11/01/26 12:05 AM", 0], ["11/01/26 12:05 PM", 12], ["11/01/26 04:05 PM", 16]])("parses %s as local time", (value, hour) => {
    const date = parseTaskDateTime(value)!;
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(hour);
    expect(date.getMinutes()).toBe(5);
  });
  it.each(["02/30/26 01:00 PM", "02/29/27 01:00 PM", "11/01/26 00:00 AM", "11/01/26 13:00 PM", "11/01/26 01:60 PM", "2026-11-01T13:00"])("rejects invalid input %s", value => expect(parseTaskDateTime(value)).toBeNull());
  it("accepts leap day", () => expect(parseTaskDateTime("02/29/28 01:00 PM")).not.toBeNull());
});
