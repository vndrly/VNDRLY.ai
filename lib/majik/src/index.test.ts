import { describe, expect, it } from "vitest";
import {
  MAJIK_STALE_MS,
  computeMajikPresenceState,
  majikWidgetHeightPx,
} from "@workspace/majik";

describe("computeMajikPresenceState", () => {
  const now = Date.parse("2026-06-15T12:00:00.000Z");

  it("returns down when not up", () => {
    expect(computeMajikPresenceState(false, new Date(now), now)).toEqual({
      effectiveUp: false,
      state: "down",
    });
  });

  it("returns up when fresh", () => {
    const updatedAt = new Date(now - 30 * 60 * 1000);
    expect(computeMajikPresenceState(true, updatedAt, now)).toEqual({
      effectiveUp: true,
      state: "up",
    });
  });

  it("returns stale after four hours", () => {
    const updatedAt = new Date(now - MAJIK_STALE_MS - 1);
    expect(computeMajikPresenceState(true, updatedAt, now)).toEqual({
      effectiveUp: false,
      state: "stale",
    });
  });
});

describe("majikWidgetHeightPx", () => {
  it("grows with member count up to eight", () => {
    const h4 = majikWidgetHeightPx(4);
    const h8 = majikWidgetHeightPx(8);
    expect(h8).toBeGreaterThan(h4);
  });
});
