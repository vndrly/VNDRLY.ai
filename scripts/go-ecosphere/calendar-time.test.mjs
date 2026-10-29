import { test } from "node:test";
import assert from "node:assert/strict";
import { civilTime, dayKey } from "./calendar-time.mjs";
test("fractional visitor arrival hours retain their minutes", () =>
  assert.equal(
    civilTime("2026-10-29", 0, 8.5).toISOString(),
    "2026-10-29T13:30:00.000Z",
  ));
test("night post across fall DST lasts thirteen elapsed hours", () =>
  assert.equal(
    (civilTime("2026-10-31", 1, 6) - civilTime("2026-10-31", 0, 18)) / 3600000,
    13,
  ));
test("day shifts keep Central wall time after DST", () => {
  assert.equal(
    civilTime("2026-10-29", 7, 6).toISOString(),
    "2026-11-05T12:00:00.000Z",
  );
  assert.equal(dayKey(civilTime("2026-10-29", -29, 6)), "2026-09-30");
});
