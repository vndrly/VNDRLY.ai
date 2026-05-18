// Unit tests for the canonical ticket tracking-number formatter.
// The formatter is a pure function exported from `@workspace/db`; it is
// the single source of truth for the "VNDRLY-00000009" string we will
// surface in the 6-step stepper redesign (Task #496) and downstream
// notifications. This file therefore locks down zero-pad behaviour at
// the boundaries of single-, double-, eight- and nine-digit ids.
//
// Lives under api-server/src so it picks up vitest's `src/**/*.test.ts`
// include glob and shares the workspace's existing pg-friendly node
// environment (vndrly's jsdom suite cannot import @workspace/db without
// adding it as a runtime dep, which it has no reason to take).

import { describe, expect, it } from "vitest";

import { formatTicketTrackingNumber } from "@workspace/db";

describe("formatTicketTrackingNumber", () => {
  it("pads single-digit ids to eight digits", () => {
    expect(formatTicketTrackingNumber(1)).toBe("VNDRLY-00000001");
    expect(formatTicketTrackingNumber(9)).toBe("VNDRLY-00000009");
  });

  it("pads two-digit and three-digit ids correctly", () => {
    expect(formatTicketTrackingNumber(99)).toBe("VNDRLY-00000099");
    expect(formatTicketTrackingNumber(100)).toBe("VNDRLY-00000100");
  });

  it("does not pad once the id reaches eight digits", () => {
    expect(formatTicketTrackingNumber(99_999_999)).toBe("VNDRLY-99999999");
  });

  it("lets nine-digit ids grow naturally rather than truncating", () => {
    // Ids beyond 99,999,999 are never silently truncated — the formatter
    // returns the full number so tracking numbers remain unique and the
    // ordering matches the underlying serial.
    expect(formatTicketTrackingNumber(100_000_000)).toBe("VNDRLY-100000000");
  });

  it("rejects non-positive or non-integer ids", () => {
    expect(() => formatTicketTrackingNumber(0)).toThrow();
    expect(() => formatTicketTrackingNumber(-1)).toThrow();
    expect(() => formatTicketTrackingNumber(1.5)).toThrow();
    expect(() => formatTicketTrackingNumber(Number.NaN)).toThrow();
  });
});
