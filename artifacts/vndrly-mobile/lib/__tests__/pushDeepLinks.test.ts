import { describe, expect, it } from "vitest";

import {
  notificationIdFromPushData,
  routeForPushData,
} from "@/lib/pushDeepLinks";

describe("routeForPushData", () => {
  it("routes crew_removed to home", () => {
    expect(routeForPushData({ type: "crew_removed" })).toEqual({
      type: "route",
      path: "/(tabs)",
    });
  });

  it("routes crew_added with ticketId to ticket detail", () => {
    expect(routeForPushData({ type: "crew_added", ticketId: 224 })).toEqual({
      type: "route",
      path: "/ticket/224",
    });
  });

  it("parses ticket id from link when ticketId missing", () => {
    expect(
      routeForPushData({ type: "ticket_note_added", link: "/tickets/231#note" }),
    ).toEqual({ type: "route", path: "/ticket/231" });
  });

  it("falls back to notifications inbox for schedule without ticket", () => {
    expect(routeForPushData({ type: "schedule_changed" })).toEqual({
      type: "route",
      path: "/notifications",
    });
  });
});

describe("notificationIdFromPushData", () => {
  it("extracts numeric notification id", () => {
    expect(notificationIdFromPushData({ notificationId: 42 })).toBe(42);
    expect(notificationIdFromPushData({ notificationId: "99" })).toBe(99);
  });
});
